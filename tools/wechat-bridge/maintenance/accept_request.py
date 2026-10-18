"""Local maintainer experiment. Never expose this entry point as an Agent tool."""
import argparse,json,pathlib,sys
from cshell_wechat.contracts import require
from cshell_wechat.friend_accept import validate,attempt
from cshell_wechat.windows import Memory
from cshell_wechat.state import state_dir

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--confirm-target',required=True)
    parser.add_argument('--acknowledge-unstable',action='store_true')
    args=parser.parse_args()
    memory=None
    try:
        require(args.acknowledge_unstable,'EXPERIMENT_REQUIRED','Known injection instability must be acknowledged locally')
        raw=sys.stdin.buffer.read(65537)
        require(len(raw)<=65536,'INPUT_LIMIT','Snapshot exceeds 64 KiB')
        request=json.loads(raw.decode('utf-8-sig'))
        require(request.get('target')==args.confirm_target,'TARGET_MISMATCH','Explicit target must match the locally verified snapshot')
        binding=request.get('binding',{})
        validate(request,binding)
        require(type(binding.get('pid')) is int and binding['pid']>0,'INVALID_PID','Explicit PID required')
        memory=Memory(binding['pid']);current,path,base=memory.inspect()
        validate(request,current)
        # Snapshot authenticity comes from the operator's trusted local read.
        # This is not an authorization backend for remote model-supplied input.
        def check():validate(request,current)
        result=attempt(memory,current,path,base,request,state_dir(),check)
        print(json.dumps({'ok':True,'result':result}))
    except Exception as error:
        print(json.dumps({'ok':False,'error':{'code':getattr(error,'code','FAILED')}}))
        return 1
    finally:
        if memory:memory.close()
    return 0

if __name__=='__main__':sys.exit(main())
