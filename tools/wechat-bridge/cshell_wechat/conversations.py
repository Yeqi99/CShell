"""Recent conversation metadata from SessionTable, without marking messages read."""
import base64,json
from .contracts import require,fingerprint
from .database_read import query_database

def prepare(params):
    limit=params.get('limit',50)
    require(type(limit) is int and 1<=limit<=100,'INVALID_LIMIT','Use 1..100 conversations')
    hidden=params.get('includeHidden',False)
    require(type(hidden) is bool,'INVALID_FILTER','includeHidden must be boolean')
    cursor=None;where='1' if hidden else 'COALESCE(is_hidden,0)=0'
    if params.get('cursor') is not None:
        raw=params['cursor'];require(isinstance(raw,str) and len(raw)<=2048,'INVALID_CURSOR','Bounded cursor required')
        try:cursor=json.loads(base64.b64decode(raw,validate=True))
        except Exception:require(False,'INVALID_CURSOR','Malformed cursor')
        require(isinstance(cursor,dict) and cursor.get('version')==1 and cursor.get('scope')=='conversations' and cursor.get('includeHidden')==hidden,'INVALID_CURSOR','Cursor filter differs')
        require(isinstance(cursor.get('database'),str) and len(cursor['database'])==64,'INVALID_CURSOR','Database scope required')
        key=cursor.get('sort');name=cursor.get('id')
        require(isinstance(key,str) and key.lstrip('-').isdigit() and len(key)<=20 and -2**63<=int(key)<2**63,'INVALID_CURSOR','Invalid sorting value')
        require(isinstance(name,str) and 0<len(name.encode('utf8'))<=256 and '\0' not in name,'INVALID_CURSOR','Invalid identity')
        literal="CAST(X'"+name.encode('utf8').hex()+"' AS TEXT)"
        where+=f' AND (COALESCE(sort_timestamp,0)<{int(key)} OR (COALESCE(sort_timestamp,0)={int(key)} AND username>{literal}))'
    sql=f'SELECT username,unread_count,last_timestamp,COALESCE(sort_timestamp,0),last_msg_type,last_msg_sender,is_hidden,type FROM SessionTable WHERE {where} ORDER BY COALESCE(sort_timestamp,0) DESC,username ASC LIMIT {limit+1}'
    return limit,hidden,cursor,sql

def result_page(raw,params):
    limit,hidden,cursor,_=prepare(params)
    require(raw['state'][1]==2 and raw['state'][3]==101,'CONVERSATIONS_UNAVAILABLE','Session database read incomplete')
    require(raw['cleanup'].get('unloaded') and raw['cleanup'].get('codeRestored'),'CLEANUP_FAILED','Reader cleanup unconfirmed')
    database=fingerprint(raw['databasePath'])
    require(cursor is None or cursor['database']==database,'CURSOR_SCOPE_CHANGED','Account database changed')
    rows=raw['rows'];more=len(rows)>limit;selected=rows[:limit]
    items=[]
    for row in selected:
        name,unread,last,sort,kind,sender,is_hidden,native_type=row
        items.append({'conversationId':name,'conversationType':'group' if name.endswith('@chatroom') else 'private-or-system',
                      'unreadCount':int(unread or 0),'lastActivityTimestamp':last,'sortValue':sort,
                      'lastMessageType':kind,'lastSenderId':sender,'hidden':bool(int(is_hidden or 0)),'nativeSessionType':native_type})
    token=base64.b64encode(json.dumps({'version':1,'scope':'conversations','database':database,'includeHidden':hidden,'sort':selected[-1][3],'id':selected[-1][0]}).encode()).decode() if selected else params.get('cursor')
    return {'items':items,'nextCursor':token,'hasMore':more,'source':'local-session-database','snapshot':False,
            'order':'client sort_timestamp DESC, username ASC; sort value is opaque, not a verified pin flag',
            'messageContentIncluded':False,'marksRead':False,'limitations':['Concurrent new messages may move rows across pages; refresh from the first page and deduplicate by conversationId','Database records can include system or deleted contacts; not a send authorization']}

def conversations(memory,binding,path,base,params,check):
    _,_,_,sql=prepare(params)
    return result_page(query_database(memory,binding,path,base,'session.db',sql,'filehelper',check),params)
