"""Exact-build experimental acceptance; native return is not server confirmation."""
import base64
import json
import re
import time
from .contracts import require, identifier, fingerprint
from .friend_detail import decode_detail
from .runtime import Instrument, ROOT, bounded
from .state import SendJournal, exclusive

MODULE = '0cf6379405432385a1c442766443450f26a7689f45e53c1b4ad2822061f3113b'
OFFSETS = {'get_coro':0x47220,'get_svc':0x381870,'get_verify':0x7669c0,
           'build_verify':0x1a2a160,'destroy_result':0x766b40}

def validate(request, binding, now=None):
    now = time.time() if now is None else now
    require(isinstance(request, dict), 'INVALID_REQUEST', 'Request object required')
    allowed = {'binding','target','encryptedIdentity','ticket','scene','detailBase64','observedAt'}
    require(set(request) == allowed, 'INVALID_REQUEST', 'Exact snapshot fields required; options are unsupported')
    require(request['binding'] == binding, 'SESSION_CHANGED', 'Snapshot belongs to another process session')
    require(binding.get('moduleSha256') == MODULE, 'UNSUPPORTED_VERSION', 'Exact verified module required')
    target = identifier(request['target'])
    require(target.startswith('wxid_'), 'INVALID_TARGET', 'Friend acceptance requires an individual internal ID')
    require(type(request['scene']) is int and request['scene'] == 30, 'UNVERIFIED_SOURCE', 'Only source 30 has passed live acceptance verification')
    observed = request['observedAt']
    require(type(observed) in (int,float) and 0 <= now-observed <= 300, 'STALE_REQUEST', 'Read a fresh request snapshot within five minutes')
    for field,prefix in [('encryptedIdentity','v3_'),('ticket','v4_')]:
        value=request[field]
        require(isinstance(value,str) and value.startswith(prefix) and 16 <= len(value) <= 4096
                and re.fullmatch(r'[\x21-\x7e]+',value), 'INVALID_TICKET', 'Invalid verification identity or ticket')
    detail=decode_detail({'detailBase64':request['detailBase64']})
    require(detail['rawFlags'].get('2') == 1, 'NOT_PENDING', 'Snapshot does not match the observed pending state')
    return target

def native_accept(memory,binding,path,base,request,check):
    validate(request,binding)
    adapter=Instrument(memory,binding,path,base)
    result={'status':'unknown','acceptanceConfirmed':False,'experimental':True,'automaticRetry':False}
    try:
        config={'offsets':OFFSETS,'guards':{n:adapter.guard(r) for n,r in OFFSETS.items()},
                'identity':request['encryptedIdentity'],'ticket':request['ticket'],
                'code':(ROOT/'native/accept.c').read_text()}
        check()
        rpc=adapter.start('const config='+json.dumps(config)+';'+(ROOT/'native/accept.js').read_text())
        check();bounded(rpc.arm)
        for _ in range(120):
            check(); result['state']=bounded(rpc.status)
            if result['state'][1]==2:break
            time.sleep(.5)
    except Exception as error:
        # No raw exception text: native errors can contain strings from inputs.
        result['errorCode']=getattr(error,'code','NATIVE_ERROR')
    finally:
        result['cleanup']=adapter.close()
        final=getattr(adapter,'stopped_state',None)
        if isinstance(final,dict) and isinstance(final.get('state'),list):result['state']=final['state']
    state=result.get('state',[])
    clean=result['cleanup'].get('unloaded') and result['cleanup'].get('codeRestored')
    if clean and len(state)==6 and state[2]==0:
        if state[1]==2 and state[3]==6 and state[4]==1:result['status']='native_returned'
        elif state[4]==0:result['status']='not_submitted'
    return result

def attempt(memory,binding,path,base,request,directory,check):
    validate(request,binding);check()
    with exclusive(directory/'operation.lock'):
        journal=SendJournal(directory/'accept-journal.sqlite3')
        try:
            # A caller cannot evade deduplication by changing an invocation key,
            # process ID, timestamp, or module version. Journal stores hashes only.
            key=fingerprint([request['encryptedIdentity'],request['ticket']])
            record,existing=journal.reserve('friend-accept-v1',key,
                [request['target'],request['encryptedIdentity'],request['ticket'],request['scene']])
            if existing:return {'status':existing,'replayed':True,'newSubmission':False,'acceptanceConfirmed':False}
            outcome=native_accept(memory,binding,path,base,request,check)
            journal.finish(record,outcome['status'])
            return outcome
        finally:journal.close()
