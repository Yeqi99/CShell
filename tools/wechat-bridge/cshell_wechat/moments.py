"""Bounded local SNS cache reads. No server refresh or publishing."""
import base64,json,re,sqlite3,time
from contextlib import closing
from xml.etree import ElementTree as ET
from .contracts import require,fingerprint
from .database_read import query_database

def parse_post(post_id,author,content):
    result={'postId':str(post_id),'authorId':author or '', 'contentStatus':'unparsed'}
    if content is None:
        return dict(result,contentStatus='oversized-or-null')
    if len(content.encode('utf8'))>8192 or re.search(r'<!\s*(DOCTYPE|ENTITY)',content,re.I):
        return dict(result,contentStatus='rejected-xml')
    try:
        root=ET.fromstring(content)
        stack=[(root,1)];count=0
        while stack:
            node,depth=stack.pop();count+=1
            if depth>24 or count>512:return dict(result,contentStatus='xml-limit')
            stack.extend((child,depth+1) for child in node)
        if root.tag=='SnsDataItem':root=root.find('TimelineObject')
        if root is None or root.tag!='TimelineObject':return dict(result,contentStatus='unknown-format')
        result['sourceDigest']=fingerprint(content)
        server_id=root.findtext('id')
        if server_id and server_id.isdecimal() and 0<int(server_id)<2**64:
            result['postId']=str(int(server_id))
        elif re.fullmatch('-?[0-9]{1,20}',str(post_id)) and -2**63<=int(post_id)<2**64:
            result['postId']=str(int(post_id)%(2**64))
        result.update(contentStatus='parsed',text=root.findtext('contentDesc') or '',
                      authorId=author or root.findtext('username') or '')
        stamp=root.findtext('createTime') or ''
        result['timestamp']=int(stamp) if stamp.isdigit() and len(stamp)<=12 else None
        media=[]
        for child in root.findall('./ContentObject/mediaList/media')[:32]:
            # Do not expose access keys/tokens or download URLs to model output.
            media.append({'id':child.findtext('id'),'type':child.findtext('type'),
                          'description':child.findtext('description') or ''})
        result['media']=media;result['mediaDownloaded']=False
        return result
    except (ET.ParseError,ValueError):return dict(result,contentStatus='malformed-xml')

def prepare(params):
    limit=params.get('limit',5)
    require(type(limit) is int and 1<=limit<=5,'INVALID_LIMIT','Use 1..5 posts per native page')
    cursor=None;where='1'
    if params.get('cursor') is not None:
        token=params['cursor'];require(isinstance(token,str) and len(token)<=1024,'INVALID_CURSOR','Bounded cursor required')
        try:cursor=json.loads(base64.b64decode(token,validate=True))
        except Exception:require(False,'INVALID_CURSOR','Malformed cursor')
        require(isinstance(cursor,dict) and cursor.get('scope')=='moments-v1' and re.fullmatch('[a-f0-9]{64}',str(cursor.get('database',''))),'INVALID_CURSOR','Invalid scope')
        tid=cursor.get('tid')
        require(isinstance(tid,str) and re.fullmatch('-?[0-9]{1,19}',tid) and -2**63<=int(tid)<2**63,'INVALID_CURSOR','Invalid native ID')
        where=f'tid < {int(tid)}'
    sql=f"SELECT CAST(tid AS TEXT),user_name,CASE WHEN length(CAST(content AS BLOB))<=8192 THEN content ELSE NULL END FROM SnsTimeLine WHERE {where} ORDER BY tid DESC LIMIT {limit+1}"
    return limit,cursor,sql

def result_page(raw,params):
    limit,cursor,_=prepare(params)
    require(raw['state'][1]==2 and raw['state'][3]==101,'MOMENTS_UNAVAILABLE','SNS read incomplete')
    require(raw['cleanup'].get('unloaded') and raw['cleanup'].get('codeRestored'),'CLEANUP_FAILED','Reader cleanup unconfirmed')
    scope=fingerprint(raw['databasePath'])
    require(cursor is None or cursor['database']==scope,'CURSOR_SCOPE_CHANGED','Account database changed')
    rows=raw['rows'];selected=rows[:limit]
    token=base64.b64encode(json.dumps({'scope':'moments-v1','database':scope,'tid':str(selected[-1][0])}).encode()).decode() if selected else None
    return {'items':[parse_post(*row) for row in selected],'nextCursor':token,'hasMore':len(rows)>limit,
            'accountScope':scope,'source':'local-sns-database','serverRefreshed':False,'complete':False,
            'limitations':['Only locally cached posts; no server refresh','Native signed tid order is not a verified chronological order','Restart paging to observe edits; missing posts are not deletion evidence','Media metadata only; oversized content is explicitly omitted']}

def record_changes(directory,page):
    """Persist bounded per-account observations; never infer deletes from partial pages."""
    directory.mkdir(parents=True,exist_ok=True)
    with closing(sqlite3.connect(directory/'moments-cache.sqlite3',timeout=2)) as db, db:
        db.execute('PRAGMA auto_vacuum=FULL')
        db.execute('CREATE TABLE IF NOT EXISTS posts(scope TEXT,id TEXT,digest TEXT,payload TEXT,seen INTEGER,PRIMARY KEY(scope,id))')
        changes=[]
        for item in page['items']:
            if item['contentStatus']!='parsed':continue
            digest=fingerprint(item);scope=page['accountScope'];pid=item['postId']
            old=db.execute('SELECT digest FROM posts WHERE scope=? AND id=?',(scope,pid)).fetchone()
            if not old or old[0]!=digest:changes.append({'kind':'updated' if old else 'observed','postId':pid})
            db.execute('INSERT OR REPLACE INTO posts VALUES(?,?,?,?,?)',(scope,pid,digest,json.dumps(item,ensure_ascii=False),time.time_ns()))
        excess=db.execute('SELECT count(*) FROM posts').fetchone()[0]-1000
        if excess>0:db.execute('DELETE FROM posts WHERE rowid IN (SELECT rowid FROM posts ORDER BY seen ASC LIMIT ?)',(excess,))
    return dict(page,changes=changes,cacheEvicted=max(0,excess),cacheLimit=1000,
                changeSemantics='Changes among observed posts only; evicted entries can be observed again. Not a full incremental server feed.')

def moments(memory,binding,path,base,params,check,directory):
    _,_,sql=prepare(params)
    page=result_page(query_database(memory,binding,path,base,'sns.db',sql,'filehelper',check),params)
    check()
    return record_changes(directory,page)
