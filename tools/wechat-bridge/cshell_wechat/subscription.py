"""Persistent native listener, parent-leased NDJSON pipe; no network server."""
import json,pathlib,sys,time,threading,re
from .contracts import require,identifier
from .events import EventJournal
from .state import exclusive,state_dir
from .windows import Memory
from .runtime import Instrument,ROOT,bounded,profile
from .database_read import query_database
from .protocol import decode

def account_id(path):
    parts=path.replace('\\','/').split('/')
    require('db_storage' in parts,'ACCOUNT_UNAVAILABLE','Account database path unavailable')
    folder=parts[parts.index('db_storage')-1]
    m=re.fullmatch(r'(wxid_[A-Za-z0-9_]{3,64})_[a-f0-9]{4}',folder)
    require(m is not None,'ACCOUNT_UNAVAILABLE','Unverified account directory layout')
    return m.group(1)

def listen(request,emit):
    require(type(request.get('leaseSeconds',3600)) is int and 10<=request.get('leaseSeconds',3600)<=86400,'INVALID_LEASE','Use 10..86400 seconds')
    targets=request['targets'];require(isinstance(targets,list) and 1<=len(targets)<=100,'INVALID_TARGETS','Use 1..100 targets')
    for target in targets:
        if target not in ('*','filehelper'):identifier(target)
    require('*' not in targets or targets==['*'],'INVALID_TARGETS','Wildcard must be alone')
    directory=pathlib.Path(request['directory']);directory.mkdir(parents=True,exist_ok=True)
    journal=EventJournal(directory/'events.sqlite3');adapter=None;memory=None
    deadline=time.monotonic()+request.get('leaseSeconds',3600)
    parent={'last':time.monotonic(),'closed':False}
    def heartbeat():
        for line in sys.stdin:
            if line.strip()=='ping':parent['last']=time.monotonic()
        parent['closed']=True
    threading.Thread(target=heartbeat,daemon=True).start()
    def check():
        require(not parent['closed'] and time.monotonic()-parent['last']<10,'PARENT_STOPPED','Parent lease expired')
        require(not pathlib.Path(request['cancelFile']).exists(),'CANCELLED','Subscription stopped')
        require(time.monotonic()<deadline,'LEASE_EXPIRED','Renew by starting a new subscription')
    def event(value):
        cursor=journal.append(value)
        if cursor:emit({'type':'event','cursor':cursor,'event':value})
    try:
        binding=request['binding'];memory=Memory(binding['pid']);current,path,base=memory.inspect()
        require(current==binding,'SESSION_CHANGED','Rebind the process');profile(current);check()
        with exclusive(state_dir()/'receive.lock'):
            with exclusive(state_dir()/'operation.lock'):
                raw=query_database(memory,binding,path,base,'contact.db','SELECT 1','filehelper',check)
            require(raw['state'][1]==2 and raw['state'][3]==101,'ACCOUNT_UNAVAILABLE','Could not verify database account')
            own=account_id(raw['databasePath'])
            journal.set('account',own)
            adapter=Instrument(memory,binding,path,base)
            config={'rva':0x17c8eb0,'guard':adapter.guard(0x17c8eb0),'allowed':targets,'account':own,'nativeCode':(ROOT/'native/receive.c').read_text()}
            check();rpc=adapter.start('const config='+json.dumps(config)+';'+(ROOT/'native/receive-native.js').read_text())
            journal.set('status','listening');event({'kind':'gap','reason':'subscription-start-no-history-replay'})
            emit({'type':'ready','accountId':own,'cursor':journal.token(journal.latest()),'leaseSeconds':request.get('leaseSeconds',3600)})
            last_counts=(0,0)
            while True:
                time.sleep(.25);check();batch=bounded(rpc.drain)
                counts=(batch.get('dropped',0),batch.get('errors',0))
                if counts!=last_counts or batch.get('decodeErrors',0):
                    event({'kind':'gap','reason':'native-drop-or-decode','counts':counts});last_counts=counts
                for raw_event in batch['events']:
                    try:
                        value=decode({'message':raw_event});value['kind']='message'
                        # Incoming self is the recipient; outgoing observations use the peer.
                        if value['conversationType']=='private' and value['conversationId']==own:
                            value['conversationId']=value['recipientId']
                        event(value)
                    except Exception:event({'kind':'gap','reason':'unsupported-message'})
    except Exception as error:
        code=getattr(error,'code','LISTENER_FAILED')
        journal.set('status',code);event({'kind':'gap','reason':code});emit({'type':'stopped','reason':code})
    finally:
        if adapter:
            cleanup=adapter.close();journal.set('cleanup',cleanup);emit({'type':'cleanup',**cleanup})
        if memory:memory.close()
        journal.close()

def main():
    def emit(value):print(json.dumps(value,ensure_ascii=False),flush=True)
    try:
        request=json.loads(sys.stdin.readline(65537));listen(request,emit)
    except Exception as error:emit({'type':'stopped','reason':getattr(error,'code','LISTENER_FAILED')});return 1
    return 0
if __name__=='__main__':sys.exit(main())
