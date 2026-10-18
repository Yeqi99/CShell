"""Exact-build plain-text Moments publishing. Caller holds operation.lock.

Native queue acceptance is not success. Confirmation requires a new own timeline
record with the exact text, a nonzero server ID and a recent creation timestamp.
Unknown results are durable and never automatically retried.
"""
from xml.sax.saxutils import escape
import json
import re
import time
import xml.etree.ElementTree as ET
from .contracts import require
from .runtime import Instrument, ROOT, bounded, profile
from .database_read import query_database
from .state import SendJournal

OFFSETS={'get_coro':0x47220,'alloc':0x7524b2c,'ctor':0x44552c0,
 'serialize':0x4456bb0,'native_free':0x7524b70,'get_svc':0x381870,
 'get_sns':0x1087ac0,'publish':0x30680a0}
MODULE='0cf6379405432385a1c442766443450f26a7689f45e53c1b4ad2822061f3113b'

def validate(params):
    require(isinstance(params,dict) and set(params)=={'text','visibility','idempotencyKey'},'INVALID_REQUEST','Exact text, visibility and idempotencyKey required')
    text=params['text'];key=params['idempotencyKey']
    require(isinstance(text,str) and bool(text.strip()) and len(text.encode('utf8'))<=512
            and not re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]',text),'INVALID_TEXT','Use 1..512 UTF-8 bytes of plain text')
    require(params['visibility']=='public','UNSUPPORTED_VISIBILITY','Only ordinary non-private posts are verified; existing account privacy still applies')
    require(isinstance(key,str) and re.fullmatch('[A-Za-z0-9_-]{8,128}',key),'INVALID_KEY','Stable idempotency key required')
    return text,key

def matching(memory,binding,path,base,text,check):
    sql="SELECT CAST(tid AS TEXT),content FROM SnsTimeLine WHERE instr(content,'"+escape(text).replace("'","''")+"')>0 LIMIT 20"
    raw=query_database(memory,binding,path,base,'sns.db',sql,'filehelper',check)
    require(raw['state'][1]==2 and raw['state'][3]==101,'READ_INCOMPLETE','Cannot verify existing posts')
    rows=[]
    for tid,content in raw['rows']:
        if not isinstance(content,str) or len(content.encode())>8192 or '<!DOCTYPE' in content or '<!ENTITY' in content:continue
        try:
            root=ET.fromstring(content);obj=root if root.tag=='TimelineObject' else root.find('.//TimelineObject')
            if obj is not None and obj.findtext('contentDesc')==text:
                rows.append({'postId':obj.findtext('id'),'author':obj.findtext('username'),
                             'createdAt':int(obj.findtext('createTime') or '0'),'private':obj.findtext('private')})
        except (ET.ParseError,ValueError):continue
    require(len(raw['rows'])<20,'VERIFY_LIMIT','Too many matching cached records to verify safely')
    return rows

def native_publish(memory,binding,path,base,text,check):
    adapter=Instrument(memory,binding,path,base)
    result={'status':'unknown','publicationConfirmed':False,'automaticRetry':False}
    try:
        config={'offsets':OFFSETS,'guards':{k:adapter.guard(v) for k,v in OFFSETS.items()},
                'code':(ROOT/'native/moments-publish.c').read_text(),'bytes':list(text.encode())}
        adapter.guard(0x4a09e0);adapter.guard(0x1df6220)
        check();rpc=adapter.start('const config='+json.dumps(config)+';'+(ROOT/'native/moments-publish.js').read_text())
        check();bounded(rpc.arm)
        for _ in range(60):
            check();state=bounded(rpc.status)
            if state[1]==2:break
            time.sleep(.5)
        result['state']=state
        xml=ET.fromstring(bounded(rpc.xml))
        result['author']=xml.findtext('username')
        result['payloadVerified']=xml.findtext('contentDesc')==text and xml.findtext('private')=='0' and xml.findtext('ContentObject/contentStyle')=='2'
    except Exception as error:result['errorCode']=getattr(error,'code','NATIVE_ERROR')
    finally:
        result['cleanup']=adapter.close()
        stopped=adapter.stopped_state
        if isinstance(stopped,dict) and isinstance(stopped.get('state'),list):result['state']=stopped['state']
    state=result.get('state',[])
    if len(state)==6 and state[1]==2 and state[4]==2 and result['cleanup'].get('codeRestored') and result['cleanup'].get('unloaded'):
        result['status']='submitted'
    return result

def attempt(memory,binding,path,base,params,directory,check):
    text,key=validate(params);profile(binding)
    require(binding['moduleSha256']==MODULE,'UNSUPPORTED_VERSION','Exact verified module required')
    check();journal=SendJournal(directory/'moments-publish-journal.sqlite3')
    try:
        # Global scope intentionally survives process/account switches: reusing a
        # key cannot cause a second publication after restart or rebinding.
        record,existing=journal.reserve('moments-publish-v1',key,[text,params['visibility']])
        if existing:return {'status':existing,'replayed':True,'newSubmission':False,'publicationConfirmed':existing=='confirmed'}
        before=matching(memory,binding,path,base,text,check)
        started=int(time.time());result=native_publish(memory,binding,path,base,text,check)
        journal.finish(record,result['status'])
        if result['status']=='submitted' and result.get('payloadVerified'):
            try:
                for _ in range(3):
                    check()
                    rows=matching(memory,binding,path,base,text,check)
                    fresh=[r for r in rows if r['postId'] not in {p['postId'] for p in before}
                           and r['author']==result['author'] and r['postId'] not in (None,'','0')
                           and r['createdAt']>=started-5 and r['private']=='0']
                    if len(fresh)==1:
                        result.update(status='confirmed',publicationConfirmed=True,postId=fresh[0]['postId'],createdAt=fresh[0]['createdAt'])
                        break
                    time.sleep(.5)
            except Exception as error:result['verificationError']=getattr(error,'code','VERIFICATION_FAILED')
        journal.finish(record,result['status']);result.pop('author',None)
        return result
    finally:journal.close()
