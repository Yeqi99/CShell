"""Exact-build contact remark adapter; local/native results are not server receipts."""
import json,re,time
from .contracts import require,identifier
from .runtime import Instrument,ROOT,bounded,profile
from .state import SendJournal
OFFSETS={'get_coro':0x47220,'get_svc':0x381870,'get_contact':0x4737f0,'lookup':0x102a950,'set_remark':0x10521f0}

def validate(params,write=True):
    require(isinstance(params,dict) and set(params)==({'target','remark','expectedRemark','idempotencyKey'} if write else {'target'}),'INVALID_REQUEST','Exact remark parameters required')
    target=identifier(params.get('target'))
    require(target.startswith('wxid_'),'INVALID_TARGET','Only individual internal IDs are supported')
    if write:
        for field in ('remark','expectedRemark'):
            value=params.get(field)
            require(isinstance(value,str) and len(value)<=64 and not re.search(r'[\x00-\x1f\x7f]',value),'INVALID_REMARK','Use at most 64 characters without control characters')
            try:encoded=value.encode('utf8')
            except UnicodeError:require(False,'INVALID_REMARK','Invalid Unicode')
            require(len(encoded)<=128,'INVALID_REMARK','Maximum 128 UTF-8 bytes')
        require(isinstance(params.get('idempotencyKey'),str) and re.fullmatch(r'[A-Za-z0-9_-]{8,128}',params['idempotencyKey']),'INVALID_KEY','Scoped idempotency key required')
    return target

def native_remark(memory,binding,path,base,params,check,write=True):
    target=validate(params,write);profile(binding)
    adapter=Instrument(memory,binding,path,base)
    result={'status':'unknown','serverConfirmed':False,'automaticRetry':False}
    arm_attempted=False
    try:
        config={'offsets':OFFSETS,'guards':{n:adapter.guard(r) for n,r in OFFSETS.items()},'write':write,
                'identity':list(target.encode()),'remark':list(params.get('remark','').encode()),
                'expected':list(params.get('expectedRemark','').encode()),'code':(ROOT/'native/remark.c').read_text()}
        adapter.guard(0x4a09e0)
        check();rpc=adapter.start('const config='+json.dumps(config)+';'+(ROOT/'native/remark.js').read_text());check()
        arm_attempted=True;bounded(rpc.arm)
        for _ in range(60):
            check()
            if bounded(rpc.status)[1]==2:break
            time.sleep(.5)
        result.update(bounded(rpc.result))
    except Exception as error:
        result['errorCode']=getattr(error,'code','NATIVE_ERROR')
        result['phase']='armed-or-arming' if arm_attempted else 'before-arm'
    finally:
        result['cleanup']=adapter.close()
        final=adapter.stopped_state
        if isinstance(final,dict) and isinstance(final.get('state'),list):result['state']=final['state']
    state=result.get('state',[])
    if not arm_attempted and result['cleanup'].get('unloaded') and result['cleanup'].get('codeRestored'):result['status']='not_submitted'
    if result['cleanup'].get('unloaded') and result['cleanup'].get('codeRestored') and len(state)==6 and state[2]==0:
        if state[1]==2 and state[3]==6 and state[4]==1:result['status']='native_returned'
        elif state[1]==2 and state[3]==5 and not write:result['status']='read'
        elif state[4]==0:result['status']='conflict' if state[3]==-2 else 'not_submitted'
    return result

def attempt(memory,binding,path,base,params,directory,check):
    validate(params);check()
    journal=SendJournal(directory/'remark-journal.sqlite3')
    try:
        record,existing=journal.reserve('contact-remark-v1',params['idempotencyKey'],[params['target'],params['expectedRemark'],params['remark']])
        if existing:return {'status':existing,'replayed':True,'newSubmission':False,'serverConfirmed':False}
        result=native_remark(memory,binding,path,base,params,check)
        journal.finish(record,result['status']);return result
    finally:journal.close()
