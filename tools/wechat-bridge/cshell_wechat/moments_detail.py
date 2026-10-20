"""Bounded exact-post cache detail; never refreshes or changes server state."""
import base64,json,re
import xml.etree.ElementTree as ET
from .contracts import require,fingerprint
from .database_read import query_database
from .moments import parse_post

MAX_XML_BYTES=24500

def post_id(value):
    require(isinstance(value,str) and re.fullmatch(r'[0-9]{1,20}',value) and 0<int(value)<2**64,'INVALID_POST_ID','Exact unsigned server post ID required')
    return str(int(value))

def read_post(memory,binding,path,base,value,check):
    pid=post_id(value);number=int(pid);signed=number if number<2**63 else number-2**64
    columns=['length(CAST(content AS BLOB))']+[f'hex(substr(CAST(content AS BLOB),{i*3500+1},3500))' for i in range(7)]
    raw=query_database(memory,binding,path,base,'sns.db',f"SELECT {','.join(columns)} FROM SnsTimeLine WHERE tid={signed} LIMIT 1",'filehelper',check)
    require(raw['state'][1]==2 and raw['state'][3]==101,'READ_INCOMPLETE','Post read did not complete')
    require(len(raw['rows'])==1,'POST_NOT_CACHED','Post is not in this account cache')
    row=raw['rows'][0]
    require(len(row)==8 and row[0] is not None and str(row[0]).isdigit() and 0<int(row[0])<=MAX_XML_BYTES,'POST_TOO_LARGE','Post exceeds bounded detail read')
    try:data=bytes.fromhex(''.join(row[1:]));xml=data.decode('utf8')
    except (ValueError,TypeError,UnicodeError):require(False,'INVALID_XML','Invalid encoded post')
    require(len(data)==int(row[0]),'READ_INCOMPLETE','Post data was truncated')
    return xml,fingerprint(raw['databasePath'])

def parse_detail(xml,pid):
    pid=post_id(pid)
    require(isinstance(xml,str) and len(xml.encode())<=MAX_XML_BYTES and not re.search(r'<!\s*(DOCTYPE|ENTITY)',xml,re.I),'INVALID_XML','Unsupported XML')
    try:root=ET.fromstring(xml)
    except ET.ParseError:require(False,'INVALID_XML','Malformed post XML')
    stack=[(root,1)];count=0
    while stack:
        node,depth=stack.pop();count+=1
        require(depth<=24 and count<=2048,'XML_LIMIT','Post XML exceeds structural limit')
        stack.extend((child,depth+1) for child in node)
    obj=root if root.tag=='TimelineObject' else root.find('TimelineObject')
    require(obj is not None and obj.findtext('id')==pid,'POST_MISMATCH','Cached server ID does not match requested post')
    post=parse_post(pid,'',ET.tostring(obj,encoding='unicode'))
    extra=root.find('LocalExtraInfo');items=[]
    if extra is not None:
        for kind,tag in [('like','like_user_list'),('comment','comment_user_list')]:
            for entry in extra.findall(tag+'/user_comment'):
                def number(name):
                    value=entry.findtext(name)
                    return str(int(value)) if value and re.fullmatch('[0-9]{1,20}',value) else None
                items.append({'kind':kind,'commentId':number('comment_id'),'comment64Id':number('comment_64id'),
                    'authorId':entry.findtext('username') or '', 'nickname':entry.findtext('nickname') or '',
                    'text':entry.findtext('content') or '', 'timestamp':number('create_time'),
                    'replyToCommentId':number('ref_comment_id'),'replyToComment64Id':number('ref_comment_64id'),
                    'locallyAdded':entry.findtext('is_local_added')=='1','deleted':entry.findtext('b_deleted')=='1'})
    return post,items

def detail_page(xml,scope,params):
    require(isinstance(params,dict) and not set(params)-{'postId','limit','cursor'},'INVALID_REQUEST','Unknown detail field')
    pid=post_id(params.get('postId'));limit=params.get('limit',20)
    require(type(limit) is int and 1<=limit<=50,'INVALID_LIMIT','Use 1..50 cached interactions')
    post,items=parse_detail(xml,pid);digest=fingerprint(xml);offset=0
    token=params.get('cursor')
    if token is not None:
        require(isinstance(token,str) and len(token)<=1024,'INVALID_CURSOR','Bounded cursor required')
        try:cursor=json.loads(base64.b64decode(token,validate=True))
        except Exception:require(False,'INVALID_CURSOR','Malformed detail cursor')
        require(isinstance(cursor,dict) and cursor.get('scope')==scope and cursor.get('postId')==pid and cursor.get('digest')==digest,'CURSOR_CHANGED','Account or post changed; restart detail paging')
        offset=cursor.get('offset');require(type(offset) is int and 0<=offset<=len(items),'INVALID_CURSOR','Invalid detail offset')
    end=min(offset+limit,len(items));more=end<len(items)
    next_cursor=base64.b64encode(json.dumps({'scope':scope,'postId':pid,'digest':digest,'offset':end}).encode()).decode() if more else None
    return {'post':post,'items':items[offset:end],'cachedCount':len(items),'hasMore':more,'nextCursor':next_cursor,
        'source':'local-sns-post-cache','serverRefreshed':False,'complete':False,
        'limitations':['Cached interactions only, not a complete server comment list','locallyAdded entries are not delivery confirmation','Reply IDs remain in their separate 32-bit and 64-bit namespaces']}

def details(memory,binding,path,base,params,check):
    xml,scope=read_post(memory,binding,path,base,params.get('postId'),check)
    check();return detail_page(xml,scope,params)
