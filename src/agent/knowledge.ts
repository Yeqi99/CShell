import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { TrustedCapabilityAdapter } from './capability-runtime';

const label = z.string().trim().min(1).max(160);
const address = z.object({ library: label, key: label }).strict();
export const knowledgeInputs = {
  knowledge_put: address.extend({
    kind: z.enum(['text', 'json', 'procedure']),
    title: label,
    content: z.string().min(1).max(64000).describe('text: 原文；json: 有效 JSON 字符串；procedure: JSON 字符串，包含非空 steps 字符串数组和非空 outcome 字符串，例如 {"steps":["执行检查"],"outcome":"已验证成功"}。'),
    source: z.string().max(1000).optional(),
  }),
  knowledge_get: address.extend({ id: z.string().regex(/^[a-f0-9]{64}$/) }),
  knowledge_search: z.object({
    library: label.optional(), key: label.optional(), query: z.string().max(500).optional(),
    offset: z.number().int().nonnegative().optional(),
  }).strict(),
  knowledge_similar: address.extend({ query: z.string().min(1).max(2000) }),
};

async function vectorRequest(route: string, body: unknown, signal: AbortSignal) {
  const url = process.env.CAGENT_MILVUS_URL;
  const collectionName = process.env.CAGENT_MILVUS_COLLECTION;
  if (!url || !collectionName) throw Error('请配置 Milvus 地址和集合');
  const response = await fetch(new URL('/v2/vectordb/entities/' + route, url), {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json',
      ...(process.env.CAGENT_MILVUS_TOKEN ? { Authorization: 'Bearer ' + process.env.CAGENT_MILVUS_TOKEN } : {}) },
    body: JSON.stringify({ collectionName, ...body as object }), signal,
  });
  if (!response.ok) throw Error('Milvus HTTP ' + response.status);
  const result = await response.json();
  if (result.code !== 0) throw Error('Milvus 请求失败，检查集合字段和向量维度');
  return result.data;
}
async function embed(input: string, signal: AbortSignal): Promise<number[]> {
  const url = process.env.CAGENT_EMBED_URL;
  if (!url || !process.env.CAGENT_EMBED_MODEL) throw Error('请配置嵌入服务和模型');
  const response = await fetch(url, { method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', ...(process.env.CAGENT_EMBED_TOKEN ? { Authorization: 'Bearer ' + process.env.CAGENT_EMBED_TOKEN } : {}) },
    body: JSON.stringify({ input, model: process.env.CAGENT_EMBED_MODEL }),
  });
  if (!response.ok) throw Error('嵌入服务 HTTP ' + response.status);
  return z.array(z.number()).nonempty().parse((await response.json()).data?.[0]?.embedding);
}
export function knowledgeToolConfigured(id: string) {
  return id !== 'knowledge_similar' || Boolean(process.env.CAGENT_MILVUS_URL && process.env.CAGENT_MILVUS_COLLECTION && process.env.CAGENT_EMBED_URL && process.env.CAGENT_EMBED_MODEL);
}
export function knowledgeAdapter(directory: string): TrustedCapabilityAdapter {
  async function open() {
    const { DatabaseSync } = await import('node:sqlite');
    const root = join(directory, 'knowledge');
    await mkdir(root, { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(join(root, 'records.sqlite'));
    try {
      db.exec('PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, library TEXT, key TEXT, kind TEXT, title TEXT, content TEXT, source TEXT, created INTEGER); CREATE INDEX IF NOT EXISTS records_scope ON records(library,key)');
      return db;
    } catch (error) { db.close(); throw error; }
  }
  return {
    async inspect() { (await open()).close(); return { installed: true, configured: true }; },
    async invoke(tool, args, _owner, abort) {
      const signal = AbortSignal.any([abort, AbortSignal.timeout(60000)]);
      const db = await open();
      try {
        signal.throwIfAborted();
        if (tool === 'knowledge_search') {
          const { library, key, query, offset } = knowledgeInputs.knowledge_search.parse(args);
          return { records: db.prepare('SELECT id,library,key,kind,title,source,created,substr(content,1,240) AS excerpt FROM records WHERE (? IS NULL OR library=?) AND (? IS NULL OR key=?) AND (instr(lower(title),lower(?)) OR instr(lower(content),lower(?))) ORDER BY created DESC,id LIMIT 30 OFFSET ?')
            .all(library ?? null,library ?? null,key ?? null,key ?? null,query ?? '',query ?? '',offset ?? 0) };
        }
        if (tool === 'knowledge_get') {
          const {library,key,id} = knowledgeInputs.knowledge_get.parse(args);
          return {record: db.prepare('SELECT * FROM records WHERE library=? AND key=? AND id=?').get(library,key,id) ?? null};
        }
        if (tool === 'knowledge_similar') {
          const { library,key,query } = knowledgeInputs.knowledge_similar.parse(args);
          const scope = createHash('sha256').update(JSON.stringify([library,key])).digest('hex');
          const hits = await vectorRequest('search',{data:[await embed(query,signal)], annsField:'vector', filter:'scope == "' + scope + '"',limit:10},signal);
          const lookup = db.prepare('SELECT id,title,substr(content,1,480) AS excerpt FROM records WHERE id=? AND library=? AND key=?');
          return {records:z.array(z.object({id:z.string()})).parse(hits).map(hit=>lookup.get(hit.id,library,key)).filter(Boolean)};
        }
        if (tool !== 'knowledge_put') throw Error('未知知识库操作');
        const record = knowledgeInputs.knowledge_put.parse(args);
        const {library,key,kind,title,content,source} = record;
        try {
          if (kind === 'json') JSON.parse(content);
          if (kind === 'procedure') z.object({steps:z.array(z.string().min(1)).nonempty(),outcome:z.string().min(1)}).parse(JSON.parse(content));
        } catch (error) {
          if (!(error instanceof SyntaxError || error instanceof z.ZodError)) throw error;
          return {stored:false,error:kind==='procedure'?'content 必须是 JSON 字符串，包含非空 steps 字符串数组和非空 outcome 字符串。请修正参数后重试；本次未写入记录。':'content 必须是有效 JSON 字符串。请修正后重试；本次未写入记录。'};
        }
        const id = createHash('sha256').update(JSON.stringify(record)).digest('hex');
        db.prepare('INSERT OR IGNORE INTO records VALUES (?,?,?,?,?,?,?,?)').run(id,library,key,kind,title,content,source ?? '',Date.now());
        const result = { id, stored:true, vector:'disabled', backup:'disabled' };
        if (process.env.CAGENT_MILVUS_URL) {
          try {
            const scope = createHash('sha256').update(JSON.stringify([library,key])).digest('hex');
            await vectorRequest('upsert',{data:[{id,scope,vector:await embed(title+'\n'+content,signal)}]},signal);
            result.vector='indexed';
          } catch (error) {result.vector=String(error);}
        }
        if (process.env.CAGENT_ALIST_DAV) {
          try {
            const response = await fetch(process.env.CAGENT_ALIST_DAV.replace(/\/+$/,'')+'/'+id+'.json',{method:'PUT',redirect:'error',signal,
              headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(process.env.CAGENT_ALIST_AUTH ?? '').toString('base64')},body:JSON.stringify({id,...record})});
            result.backup=response.ok?'uploaded':'HTTP '+response.status;
          } catch (error) {result.backup=String(error);}
        }
        return result;
      } finally {db.close();}
    },
  };
}
