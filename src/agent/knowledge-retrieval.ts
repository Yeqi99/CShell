import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';

const segmenter = new Intl.Segmenter('zh',{granularity:'word'});
const stop = new Set('的 了 如何 怎么 我 请 以及 the is and how to of a'.split(' '));
function words(text:string) {
  return [...segmenter.segment(text.normalize('NFKC').toLowerCase())]
    .filter(w=>w.isWordLike && !stop.has(w.segment)).map(w=>w.segment);
}

export function subqueries(query:string) {
  const parts=query.split(/(?:[？?；;\n]+|[，,]\s*(?=[^，,；;？?\n]{0,32}(?:如何|怎么|为什么|what|how|why))|另外|以及|同时还要|\band also\b|\band\s+(?=how|why|what))/iu);
  const unique=[...new Set(parts.map(s=>s.trim()).filter(Boolean))];
  return unique.length<=6 ? unique : [...unique.slice(0,5),unique.slice(5).join('；')];
}

export function passages(kind:string,content:string) {
  let text=content;
  if(kind==='json'||kind==='procedure') text=JSON.stringify(JSON.parse(content),null,2);
  const chars=Array.from(text);
  const chunks:string[]=[];
  let start=0;
  while(start<chars.length){
    let end=Math.min(start+850,chars.length);
    if(end<chars.length){
      const tail=chars.slice(start+450,end).join('');
      const boundaries=[/\n\s*\n/gu,/\n/gu,/[。！？]|[.!?](?=\s)/gu];
      const last=boundaries.map(re=>[...tail.matchAll(re)].at(-1)).find(Boolean);
      if(last) end=start+450+Array.from(tail.slice(0,last.index!+last[0].length)).length;
    }
    chunks.push(chars.slice(start,end).join(''));
    if(end===chars.length)break;
    start=end-96;
  }
  return chunks;
}

type Document = {id:string;title:string;kind:string;content:string};
export function initPassages(db:DatabaseSync){
  db.exec(`CREATE TABLE IF NOT EXISTS passages(cid TEXT UNIQUE, doc TEXT NOT NULL, part INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(doc,part));
    CREATE TABLE IF NOT EXISTS passage_migration (singleton INTEGER PRIMARY KEY, through_row INTEGER NOT NULL);
    INSERT OR IGNORE INTO passage_migration VALUES (1,0);
    CREATE VIRTUAL TABLE IF NOT EXISTS passage_terms USING fts5(title,body)`);
}
export function indexDocument(db:DatabaseSync,doc:Document){
  if(db.prepare('SELECT 1 FROM passages WHERE doc=? LIMIT 1').get(doc.id))return;
  const add=db.prepare('INSERT INTO passages(cid,doc,part,body) VALUES(?,?,?,?)');
  const terms=db.prepare('INSERT INTO passage_terms(rowid,title,body) VALUES(?,?,?)');
  const title=words(doc.title).join(' ');
  for(const [part,body] of passages(doc.kind,doc.content).entries()){
    const cid=createHash('sha256').update(doc.id+':'+part).digest('hex');
    const row=add.run(cid,doc.id,part,body);
    terms.run(row.lastInsertRowid,title,words(body).join(' '));
  }
}

export async function backfill(db:DatabaseSync,signal:AbortSignal){
  // Older installations store only records. Commit each batch independently so interrupted upgrades can resume.
  for(;;){
    signal.throwIfAborted();
    const pending=db.prepare('SELECT 1 FROM records WHERE rowid>(SELECT through_row FROM passage_migration WHERE singleton=1) LIMIT 1').get();
    if(!pending)return;
    db.exec('BEGIN IMMEDIATE');
    let count=0;
    try{
      const batch=db.prepare('SELECT rowid,id,title,kind,content FROM records WHERE rowid>(SELECT through_row FROM passage_migration WHERE singleton=1) ORDER BY rowid LIMIT 24').all();
      count=batch.length;
      for(const row of batch)indexDocument(db,row as Document);
      if(count)db.prepare('UPDATE passage_migration SET through_row=? WHERE singleton=1').run(batch[count-1].rowid);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    if(count<24)return;
    await new Promise(resolve=>setImmediate(resolve));
  }
}

export type Hit={id:string;cid:string;part:number;title:string;body:string;source:string;library:string;key:string;kind:string;created:number};
export const hitFields='r.id,p.cid,p.part,r.title,p.body,r.source,r.library,r.key,r.kind,r.created';
export function sparse(db:DatabaseSync,query:string,library:string|undefined,key:string|undefined,limit:number):Hit[]{
  const tokens=[...new Set(words(query))].slice(0,24);
  // Expand common classroom terminology on query, so existing indexes remain usable.
  const aliases: Array<[RegExp, string]> = [
    [/全表|扫描整张表/u, '执行计划 EXPLAIN 扫描'],
    [/(对象|字符串).*(相等|一样|相同)/u, 'equals 字符串 引用'],
  ];
  for(const [pattern, synonyms] of aliases){
    if(pattern.test(query))tokens.push(...words(synonyms));
  }
  if(!tokens.length)return [];
  const match=tokens.map(w=>'"'+w.replaceAll('"','""')+'"').join(' OR ');
  // Pick the best passage of each document before applying the page limit.
  return db.prepare(`WITH hits AS MATERIALIZED (SELECT ${hitFields},bm25(passage_terms,2,1) AS weight
    FROM passage_terms JOIN passages p ON p.rowid=passage_terms.rowid JOIN records r ON r.id=p.doc
    WHERE passage_terms MATCH ? AND (? IS NULL OR r.library=?) AND (? IS NULL OR r.key=?)),
    best AS (SELECT *,row_number() OVER(PARTITION BY id ORDER BY weight,part) AS n FROM hits)
    SELECT * FROM best WHERE n=1 ORDER BY weight,created DESC,id LIMIT ?`)
    .all(match,library??null,library??null,key??null,key??null,limit) as Hit[];
}
export function fuse(lists:Hit[][]):Hit[]{
  const scores=new Map<string,{hit:Hit;score:number;rank:number}>();
  for(const list of lists){
    const seen=new Set<string>();
    list.forEach((hit,i)=>{
      if(seen.has(hit.id))return;
      seen.add(hit.id);
      const item=scores.get(hit.id)??{hit,score:0,rank:i};
      item.score+=1/(60+i+1);
      if(i<item.rank){item.hit=hit;item.rank=i;}
      scores.set(hit.id,item);
    });
  }
  return [...scores.values()].sort((a,b)=>b.score-a.score||a.rank-b.rank).map(item=>item.hit);
}
export function assemble(queries:string[],lists:Hit[][],offset:number,limit:number){
  const result=new Map<string,Record<string,unknown>>();
  const depth=Math.max(0,...lists.map(list=>list.length));
  for(let i=0;i<depth;i++)for(const [j,list] of lists.entries()){
    const hit=list[i];if(!hit)continue;
    const positions=words(queries[j]).map(term=>hit.body.toLowerCase().indexOf(term)).filter(n=>n>=0);
    const start=Math.max(0,(positions[0]??0)-64);
    const evidence={part:hit.part,chunkId:hit.cid,excerpt:hit.body.slice(start,start+360),matchedQuery:queries[j]};
    const existing=result.get(hit.id);
    if(existing){
      const other=(existing.otherMatches??=[]) as typeof evidence[];
      if(existing.matchedQuery!==queries[j])other.push(evidence);
      continue;
    }
    result.set(hit.id,{id:hit.id,library:hit.library,key:hit.key,title:hit.title,source:hit.source,created:hit.created,kind:hit.kind,...evidence});
  }
  return [...result.values()].slice(offset,offset+limit);
}
