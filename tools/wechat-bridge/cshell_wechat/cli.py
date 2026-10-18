"""One bounded JSON request on stdin; JSON result on stdout. No TCP port."""
import argparse
import json
import pathlib
import sys
from .contracts import BridgeError, require, identifier, text_request
from .state import state_dir, load_policy, authorize, exclusive, SendJournal

METHODS = {
 'friend_requests.accept': {'sideEffect':'accepts one friend request','verification':'one source-30 request confirmed; unstable candidate','authorization':'blocked pending production validation'},
 'friend_requests.decode_detail': {'sideEffect':'none','authorization':'caller-provided base64 payload only','verification':'wire-layout-observed-12-records; status unknown'},
 'messages.decode': {'sideEffect':'none','authorization':'caller-provided payload only'},
 'inspect': {'sideEffect':'none','authorization':'local process metadata'},
 'contacts.cached': {'sideEffect':'bounded process-memory read','authorization':'readContacts','complete':False},
 'messages.listen': {'sideEffect':'temporary receive hook','authorization':'receive target allowlist','maxSeconds':300},
 'messages.send_text': {'sideEffect':'sends one text message','authorization':'send target allowlist','idempotency':'required; unknown outcomes never retried'},
}

def execute(method,params,directory):
    from .windows import Memory
    from .runtime import profile, send, receive
    if method=='capabilities':
        from .runtime import ROOT
        profiles=[json.loads(p.read_text(encoding='utf8')) for p in (ROOT/'profiles').glob('*.json')]
        return {'protocolVersion':1,'methods':{k:v for k,v in METHODS.items() if k not in ('messages.listen','messages.send_text','friend_requests.accept')},'experimentalBlocked':['messages.listen','messages.send_text','friend_requests.accept'],
                'profiles':[{'version':p['version'],'status':p['status'],'liveEnabled':p.get('liveEnabled',False)} for p in profiles],
                'unavailable':['contacts.full','groups.members','messages.history','messages.send_image','messages.send_file','messages.recall','groups.manage'],
                'automaticVersionFallback':False,'networkListener':False}
    if method=='friend_requests.decode_detail':
        from .friend_detail import decode_detail
        return decode_detail(params)
    if method=='messages.decode':
        from .protocol import decode
        return decode(params)
    if method=='friend_requests.accept':
        require(False,'ADAPTER_QUARANTINED','Acceptance candidate requires local maintenance verification; not available to Agent callers')
    policy_path=directory/'policy.json'
    if method=='disable':
        policy=load_policy(policy_path);policy['enabled']=False
        temporary=policy_path.with_suffix('.tmp');temporary.write_text(json.dumps(policy,indent=2),encoding='utf8');temporary.replace(policy_path)
        return {'enabled':False}
    require(method in METHODS or method=='configure','UNKNOWN_METHOD','Unknown method')
    pid=params.get('pid')
    require(type(pid) is int and pid>0,'INVALID_PID','An explicit Weixin process ID is required')
    memory=Memory(pid)
    try:
        binding,path,base=memory.inspect();adapter_profile=profile(binding)
        if method=='inspect':
            return {'binding':binding,'modulePath':path,'version':adapter_profile['version'],'verification':adapter_profile['status'],'enabled':load_policy(policy_path).get('enabled',False)}
        if method in ('messages.listen','messages.send_text'):
            require(adapter_profile.get('liveEnabled') is True,'ADAPTER_QUARANTINED',adapter_profile.get('quarantineReason','Live stability not validated'))
        if method=='configure':
            require(params.get('confirm') is True,'CONFIRM_REQUIRED','Local configuration requires confirm:true')
            for action in ('send','receive'):
                require(isinstance(params.get(action,[]),list) and len(params.get(action,[]))<=100,'INVALID_POLICY','Allowlist must contain at most 100 IDs')
                for item in params.get(action,[]):identifier(item)
            policy={'enabled':params.get('enabled') is True,'binding':binding,'readContacts':params.get('readContacts') is True,
                    'send':params.get('send',[]),'receive':params.get('receive',[])}
            temporary=policy_path.with_suffix('.tmp');temporary.write_text(json.dumps(policy,indent=2),encoding='utf8');temporary.replace(policy_path)
            return policy
        def check(operation,target=None):
            # Recheck local authorization while a temporary hook or scan is active.
            authorize(load_policy(policy_path),binding,operation,target)
        with exclusive(directory/'operation.lock'):
            if method=='contacts.cached':
                check('contacts');budget=params.get('budgetMB',256)
                require(type(budget) is int and 16<=budget<=512,'INVALID_BUDGET','budgetMB must be 16..512')
                return memory.cached_contacts(lambda:check('contacts'),budget_mb=budget)
            if method=='messages.listen':
                targets=params.get('targets');seconds=params.get('seconds',30)
                require(isinstance(targets,list) and 1<=len(targets)<=100,'INVALID_TARGETS','Choose 1..100 explicit targets')
                require(type(seconds) is int and 1<=seconds<=300,'INVALID_DURATION','seconds must be 1..300')
                for target in targets:identifier(target)
                def receive_check():
                    for target in targets:check('receive',target)
                receive_check()
                return receive(memory,binding,path,base,targets,seconds,receive_check)
            recipient,text,key=text_request(params);check('send',recipient)
            journal=SendJournal(directory/'send-journal.sqlite3')
            try:
                record,existing=journal.reserve(binding,key,[recipient,text])
                if existing:
                    return {'status':existing,'replayed':True,'newSend':False,'deliveryConfirmed':False}
                outcome=send(memory,binding,path,base,recipient,text,lambda:check('send',recipient))
                journal.finish(record,outcome['status'])
                return outcome
            finally:journal.close()
    finally:memory.close()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('method');parser.add_argument('--state-dir',type=pathlib.Path)
    args=parser.parse_args()
    try:
        raw=sys.stdin.buffer.read(65537)
        require(len(raw)<=65536,'INPUT_LIMIT','JSON input exceeds 64 KiB')
        params=json.loads(raw.decode('utf-8-sig')) if raw.strip() else {}
        require(isinstance(params,dict),'INVALID_INPUT','JSON object required')
        directory=args.state_dir or state_dir();directory.mkdir(parents=True,exist_ok=True)
        result=execute(args.method,params,directory)
        print(json.dumps({'ok':True,'result':result},ensure_ascii=False))
    except (Exception,KeyboardInterrupt) as error:
        print(json.dumps({'ok':False,'error':{'code':getattr(error,'code','INTERRUPTED' if isinstance(error,KeyboardInterrupt) else 'FAILED'),'message':str(error)}},ensure_ascii=False))
        sys.exit(1)

if __name__=='__main__':main()
