"""Bounded message_0.db history, on the database-owning thread. No key extraction."""
import base64,hashlib,json,time
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit
from .contracts import require,identifier,fingerprint
from .database_read import query_database,FUNCTIONS
from .payment_card import transfer_card

def prepare(params):
    target=params.get('target')
    if target!='filehelper':identifier(target)
    limit=params.get('limit',20)
    require(type(limit) is int and 1<=limit<=30,'INVALID_LIMIT','Use 1..30 records')
    direction=params.get('direction','latest')
    require(direction in ('latest','after','before'),'INVALID_DIRECTION','Use latest, after or before')
    cursor=None
    if direction!='latest':
        raw=params.get('cursor','')
        require(isinstance(raw,str) and len(raw)<=2048,'INVALID_CURSOR','Bounded cursor required')
        try:cursor=json.loads(base64.b64decode(raw,validate=True))
        except Exception:require(False,'INVALID_CURSOR','Malformed cursor')
        require(isinstance(cursor,dict) and cursor.get('target')==target and cursor.get('version')==1,'INVALID_CURSOR','Cursor target differs')
        require(isinstance(cursor.get('localId'),str) and cursor['localId'].isdigit() and len(cursor['localId'])<=19,'INVALID_CURSOR','Invalid local ID')
        require(isinstance(cursor.get('serverId'),str) and cursor['serverId'].isdigit() and len(cursor['serverId'])<=20,'INVALID_CURSOR','Invalid server ID')
        require(isinstance(cursor.get('database'),str) and len(cursor['database'])==64,'INVALID_CURSOR','Database scope required')
        require(0<=int(cursor['localId'])<=9223372036854775807 and 0<=int(cursor['serverId'])<=18446744073709551615,'INVALID_CURSOR','ID out of range')
    table='Msg_'+hashlib.md5(target.encode()).hexdigest()
    where='' if cursor is None else f"WHERE m.local_id {'>' if direction=='after' else '<'} {int(cursor['localId'])}"
    order='ASC' if direction=='after' else 'DESC'
    anchor='1' if cursor is None else f"EXISTS(SELECT 1 FROM {table} WHERE local_id={int(cursor['localId'])} AND server_id={int(cursor['serverId'])})"
    # Eight columns, bounded hex content. Oversized records remain visible as an explicit gap.
    sql=f"SELECT 'meta',COALESCE(MAX(local_id),0),{anchor},0,'','',0,0 FROM {table} UNION ALL SELECT CAST(local_id AS TEXT),server_id,local_type,create_time,user_name,body,encoding,bytes FROM (SELECT m.local_id,m.server_id,m.local_type,m.create_time,n.user_name,hex(substr(CAST(m.message_content AS BLOB),1,4096)) body,m.WCDB_CT_message_content encoding,length(CAST(m.message_content AS BLOB)) bytes FROM {table} m LEFT JOIN Name2Id n ON n.rowid=m.real_sender_id {where} ORDER BY m.local_id {order} LIMIT {limit+1})"
    return target,limit,direction,cursor,sql

def decode_body(hex_data,encoding,native_type,size):
    kind=int(native_type)&0xffffffff
    if kind not in (1,49):return None,'non-text'
    if int(size)>4096:return None,'oversized'
    data=bytes.fromhex(hex_data or '')
    try:
        if data.startswith(bytes.fromhex('28b52ffd')):
            import zstandard as zstd
            info=zstd.get_frame_parameters(data)
            if info.window_size>1_048_576 or (info.content_size not in (zstd.CONTENTSIZE_UNKNOWN,zstd.CONTENTSIZE_ERROR) and info.content_size>65536):return None,'oversized'
            with zstd.ZstdDecompressor().stream_reader(data) as reader:data=reader.read(65537)
            if len(data)>65536:return None,'oversized'
        elif encoding not in (None,'0',0):return None,'unsupported-encoding'
        decoded=data.decode('utf8')
        if kind==49:
            if '<!DOCTYPE' in decoded.upper() or '<!ENTITY' in decoded.upper():return None,'invalid-article'
            root=ET.fromstring(decoded)
            app=root if root.tag=='appmsg' else root.find('appmsg')
            if app is None:return None,'non-text'
            payment=transfer_card(app)
            if payment is not None:return json.dumps(payment,ensure_ascii=False),'payment-card'
            if app.findtext('type')!='5':return None,'non-text'
            url=(app.findtext('url') or '').strip()
            parsed=urlsplit(url)
            if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password:return None,'invalid-article'
            # Only expose card fields, never the full XML or embedded account tokens.
            card={'title':(app.findtext('title') or '')[:1024],'description':(app.findtext('des') or '')[:4096],'url':url[:8192]}
            return json.dumps(card,ensure_ascii=False),'article-card'
        return decoded,'text'
    except Exception:return None,'decode-failed'

def result_page(raw,params):
    target,limit,direction,cursor,_=prepare(params)
    require(raw['state'][1]==2 and raw['state'][3]==101,'HISTORY_UNAVAILABLE','Client read service unavailable, table missing, or bounded query incomplete')
    require(raw['cleanup'].get('unloaded') and raw['cleanup'].get('codeRestored'),'CLEANUP_FAILED','Native reader did not clean up')
    database=fingerprint(raw['databasePath'])
    require(cursor is None or cursor['database']==database,'CURSOR_SCOPE_CHANGED','Database/account path changed; do not reuse cursor')
    rows=raw['rows'];require(rows and rows[0][0]=='meta','HISTORY_UNAVAILABLE','Missing history metadata')
    gap=bool(cursor and rows[0][2]!='1')
    if gap:return {'events':[],'gap':True,'reason':'cursor-anchor-missing','restartRequired':True}
    more=len(rows)-1>limit;selected=rows[1:limit+1]
    if direction!='after':selected.reverse()
    events=[];seen=set()
    for row in selected:
        local,server,kind,created,sender,body,encoding,size=row
        key=target+':'+(server if server and server!='0' else 'local:'+database+':'+local)
        if key in seen:continue
        seen.add(key);text,status=decode_body(body,encoding,kind,size or '0')
        events.append({'conversationId':target,'messageId':server,'localId':local,'deduplicationKey':key,'nativeType':kind,
                       'timestamp':created,'senderId':sender,'text':text,'contentStatus':status})
    def token(row):return base64.b64encode(json.dumps({'version':1,'target':target,'database':database,'localId':row[0],'serverId':row[1] or '0'}).encode()).decode()
    return {'events':events,'newerCursor':token(selected[-1]) if selected else params.get('cursor'),
            'olderCursor':token(selected[0]) if selected else params.get('cursor'),'hasMore':more,
            'gap':any(e['contentStatus'] not in ('text','non-text','article-card','payment-card') for e in events),
            'coverage':'local message_0.db only; other shards, deleted records and remote history are not covered',
            'complete':False,'snapshot':False,'cursorAdvancesOnlyAfterRead':True}

def history(memory,binding,path,base,params,check):
    target,_,_,_,sql=prepare(params)
    raw=query_database(memory,binding,path,base,'message_0.db',sql,target,check)
    return result_page(raw,params)
