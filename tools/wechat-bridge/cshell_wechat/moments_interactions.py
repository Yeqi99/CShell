"""Bounded, read-only SNS interaction notifications from the local cache.

This is not the full comment list of arbitrary posts. Sending, replying and
liking are intentionally not exposed until their native contracts are verified.
"""
import base64
import json
import re
from .contracts import require, fingerprint
from .database_read import query_database


def post_id(value):
    require(isinstance(value,str) and re.fullmatch(r'[0-9]{1,20}',value) is not None,
            'INVALID_POST','Use the unsigned decimal server post ID')
    number=int(value)
    require(0<number<2**64,'INVALID_POST','Post ID is outside uint64')
    return str(number),number if number<2**63 else number-2**64


def prepare(params):
    require(isinstance(params,dict) and not set(params)-{'postId','limit','cursor'},'INVALID_REQUEST','Unknown interaction query field')
    public,signed=post_id(params.get('postId'))
    limit=params.get('limit',5)
    require(type(limit) is int and 1<=limit<=5,'INVALID_LIMIT','Use 1..5 notifications per native page')
    cursor=None;after=0
    if params.get('cursor') is not None:
        token=params['cursor']
        require(isinstance(token,str) and len(token)<=1024,'INVALID_CURSOR','Cursor is too large')
        try:cursor=json.loads(base64.b64decode(token,validate=True))
        except Exception:require(False,'INVALID_CURSOR','Malformed cursor')
        require(isinstance(cursor,dict) and cursor.get('scope')=='moments-interactions-v1'
                and cursor.get('postId')==public
                and re.fullmatch('[a-f0-9]{64}',str(cursor.get('database',''))) is not None,
                'INVALID_CURSOR','Cursor does not belong to this post')
        after=cursor.get('after')
        require(type(after) is int and 0<=after<2**63,'INVALID_CURSOR','Invalid local notification position')
    # Eight columns maximum is part of the native reader contract.
    sql=("SELECT CAST(local_id AS TEXT),type,from_username,to_username,"
         "CASE WHEN length(CAST(content AS BLOB))<=4096 THEN content ELSE NULL END,"
         "CAST(comment_id AS TEXT),CAST(comment64_id AS TEXT),del_status "
         f"FROM SnsMessage_tmp3 WHERE feed_id={signed} AND local_id>{after} "
         f"ORDER BY local_id ASC LIMIT {limit+1}")
    return public,limit,cursor,sql


def result_page(raw,params):
    public,limit,cursor,_=prepare(params)
    require(raw['state'][1]==2 and raw['state'][3]==101,'INTERACTIONS_UNAVAILABLE','Interaction read incomplete')
    require(raw['cleanup'].get('unloaded') and raw['cleanup'].get('codeRestored'),'CLEANUP_FAILED','Reader cleanup unconfirmed')
    scope=fingerprint(raw['databasePath'])
    require(cursor is None or cursor['database']==scope,'CURSOR_SCOPE_CHANGED','Account database changed')
    selected=raw['rows'][:limit];items=[];last=0
    for row in selected:
        require(len(row)==8,'INVALID_RECORD','Unexpected notification record')
        local,kind,author,target,text,id32,id64,deleted=row
        require(isinstance(local,str) and local.isdecimal() and 0<int(local)<2**63,'INVALID_RECORD','Invalid notification ID')
        last=int(local)
        items.append({'notificationId':local,'postId':public,
                      'kind':{'1':'like','2':'comment'}.get(kind,'unknown'),
                      'nativeType':kind,'authorId':author,'recipientId':target,
                      'text':text,'contentStatus':'available' if text is not None else 'oversized-or-null',
                      'commentId':id32,'comment64Id':id64,'deletionState':deleted})
    token=base64.b64encode(json.dumps({'scope':'moments-interactions-v1','database':scope,'postId':public,'after':last}).encode()).decode() if selected else params.get('cursor')
    return {'items':items,'nextCursor':token,'hasMore':len(raw['rows'])>limit,
            'accountScope':scope,'source':'local-sns-notifications','serverRefreshed':False,'complete':False,
            'limitations':['Notifications present in this account cache only; not the complete comment/like list',
                           'Cursor follows local notification IDs; restart paging to see edits/deletions',
                           'Like and comment identifiers are separate namespaces; use kind with the identifier']}


def interactions(memory,binding,path,base,params,check):
    _,_,_,sql=prepare(params)
    raw=query_database(memory,binding,path,base,'sns.db',sql,'filehelper',check)
    check()
    return result_page(raw,params)
