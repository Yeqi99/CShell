"""Address-book database records, not cached object guesses or a friend count."""
import base64,json
from .contracts import require,fingerprint
from .database_read import query_database

def prepare(params):
    require(isinstance(params,dict) and not set(params)-{'limit','cursor'},'INVALID_REQUEST','Only limit and cursor are supported')
    limit=params.get('limit',50)
    require(type(limit) is int and 1<=limit<=100,'INVALID_LIMIT','Use 1..100 records')
    cursor=None
    if params.get('cursor') is not None:
        raw=params['cursor'];require(isinstance(raw,str) and len(raw)<=2048,'INVALID_CURSOR','Bounded cursor required')
        try:cursor=json.loads(base64.b64decode(raw,validate=True))
        except Exception:require(False,'INVALID_CURSOR','Malformed cursor')
        require(isinstance(cursor,dict) and cursor.get('version')==1 and cursor.get('scope')=='contacts','INVALID_CURSOR','Invalid contact cursor')
        require(isinstance(cursor.get('id'),str) and cursor['id'].isdigit() and len(cursor['id'])<=19 and int(cursor['id'])<=9223372036854775807,'INVALID_CURSOR','Invalid record ID')
        require(isinstance(cursor.get('database'),str) and len(cursor['database'])==64,'INVALID_CURSOR','Database scope required')
    last=int(cursor['id']) if cursor else 0
    return limit,cursor,f'SELECT id,username,alias,remark,nick_name,flag,delete_flag,local_type FROM contact WHERE id>{last} ORDER BY id LIMIT {limit+1}'

def result_page(raw,params):
    limit,cursor,_=prepare(params)
    require(raw['state'][1]==2 and raw['state'][3]==101,'CONTACTS_UNAVAILABLE','Client read service unavailable or bounded query incomplete')
    require(raw['cleanup'].get('unloaded') and raw['cleanup'].get('codeRestored'),'CLEANUP_FAILED','Native reader did not clean up')
    database=fingerprint(raw['databasePath'])
    require(cursor is None or cursor['database']==database,'CURSOR_SCOPE_CHANGED','Database/account path changed')
    rows=raw['rows'];more=len(rows)>limit;rows=rows[:limit]
    items=[dict(zip(('recordId','id','alias','remark','name','flags','deleteFlag','localType'),row)) for row in rows]
    token=base64.b64encode(json.dumps({'version':1,'scope':'contacts','database':database,'id':rows[-1][0]}).encode()).decode() if rows else params.get('cursor')
    return {'items':items,'nextCursor':token,'hasMore':more,'source':'local-contact-database','snapshot':False,
            'complete':False,'pageExhausted':not more,
            'limitations':['Database records include groups, deleted entries and non-friend identities; not a verified friend count',
                            'Concurrent changes may require a fresh scan; never resolve a recipient solely by nickname']}

def contacts(memory,binding,path,base,params,check):
    _,_,sql=prepare(params)
    return result_page(query_database(memory,binding,path,base,'contact.db',sql,'filehelper',check),params)
