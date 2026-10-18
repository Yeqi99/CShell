"""CShell trusted backend subprocess protocol. Not an independently authorized network API."""
import csv,io,json,pathlib,subprocess,sys
from .windows import Memory
from .runtime import profile,send,receive
from .contracts import require,text_request,identifier
from .state import SendJournal,exclusive,state_dir

def execute(request):
    method=request['method'];params=request.get('params',{})
    if method=='discover':
        raw=subprocess.check_output(['tasklist.exe','/FI','IMAGENAME eq Weixin.exe','/FO','CSV','/NH'],creationflags=0x08000000,timeout=10)
        processes=[]
        for row in csv.reader(io.StringIO(raw.decode('mbcs',errors='replace'))):
            if len(row)<2 or row[0].lower()!='weixin.exe':continue
            memory=None
            try:
                memory=Memory(int(row[1]));binding,path,base=memory.inspect();p=profile(binding)
                processes.append({'pid':binding['pid'],'version':p['version'],'binding':binding})
            except Exception:pass
            finally:
                if memory:memory.close()
        return {'processes':processes,'readProtocolVersion':2,'subscriptionProtocolVersion':1,'conversationsProtocolVersion':1,'momentsProtocolVersion':1,'momentsPublishProtocolVersion':1,'momentsInteractionsProtocolVersion':1}
    if method=='events':
        from .events import EventJournal
        directory=pathlib.Path(request['directory'])
        require((directory/'events.sqlite3').is_file(),'NOT_FOUND','Subscription queue not found')
        journal=EventJournal(directory/'events.sqlite3')
        try:return journal.read(params.get('cursor'),params.get('limit',50))
        finally:journal.close()
    binding=request['binding'];memory=Memory(binding['pid'])
    try:
        current,path,base=memory.inspect();require(current==binding,'SESSION_CHANGED','WeChat process changed; bind again')
        profile(current)
        require(request.get('experimental') is True,'DISABLED','Experimental access is disabled')
        cancelled=pathlib.Path(request['cancelFile'])
        def check():require(not cancelled.exists(),'CANCELLED','Operation cancelled; submitted effects cannot be undone')
        check()
        with exclusive(state_dir()/'operation.lock'):
            if method in ('remark_read','remark_set'):
                from .remark import native_remark,attempt
                if method=='remark_read':return native_remark(memory,binding,path,base,params,check,False)
                return attempt(memory,binding,path,base,params,state_dir(),check)
            if method=='history':
                from .history import history
                return history(memory,binding,path,base,params,check)
            if method=='moments_publish':
                from .moments_publish import attempt
                return attempt(memory,binding,path,base,params,state_dir(),check)
            if method=='moments':
                from .moments import moments
                return moments(memory,binding,path,base,params,check,state_dir())
            if method=='moments_interactions':
                from .moments_interactions import interactions
                return interactions(memory,binding,path,base,params,check)
            if method=='conversations':
                from .conversations import conversations
                return conversations(memory,binding,path,base,params,check)
            if method=='contacts':
                from .contacts import contacts
                return contacts(memory,binding,path,base,params,check)
            if method=='receive':
                targets=params['targets'];seconds=params.get('seconds',15)
                require(type(seconds) is int and 1<=seconds<=30,'INVALID_DURATION','Use 1..30 seconds')
                require(isinstance(targets,list) and 1<=len(targets)<=20,'INVALID_TARGETS','Use 1..20 targets')
                for target in targets:
                    if target!='filehelper':identifier(target)
                with exclusive(state_dir()/'receive.lock'):
                    return receive(memory,binding,path,base,targets,seconds,check)
            require(method=='send','UNKNOWN_METHOD','Unsupported desktop method')
            # Existing validation deliberately excludes aliases; filehelper is a fixed built-in identity.
            special=params.get('recipient')=='filehelper'
            target,text,key=text_request(dict(params,recipient='wxid_filehelper') if special else params)
            if special:target='filehelper'
            journal=SendJournal(state_dir()/'send-journal.sqlite3')
            try:
                record,existing=journal.reserve(binding,key,[target,text])
                if existing:return {'status':existing,'replayed':True,'newSend':False,'deliveryConfirmed':False}
                result=send(memory,binding,path,base,target,text,check)
                journal.finish(record,result['status']);return result
            finally:journal.close()
    finally:memory.close()

def main():
    try:
        raw=sys.stdin.buffer.read(65537);require(len(raw)<=65536,'INPUT_LIMIT','Input too large')
        result=execute(json.loads(raw.decode('utf-8-sig')))
        print(json.dumps({'ok':True,'result':result},ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'ok':False,'error':{'code':getattr(error,'code','BRIDGE_FAILED')}}));return 1
    return 0
if __name__=='__main__':sys.exit(main())
