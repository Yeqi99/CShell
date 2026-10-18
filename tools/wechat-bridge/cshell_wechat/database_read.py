"""Fixed, bounded read-only queries scheduled through exact-build client services."""
import json,time
from .runtime import Instrument,ROOT,bounded,profile
from .contracts import require

FUNCTIONS={'db_handle':0x25279f0,'db_filename':0x35ddd00,'prepare_v2':0x5924c30,
 'stmt_readonly':0x58f9f10,'step':0x58f8400,'finalize':0x58f7b70,'column_count':0x58f8af0,
 'column_text':0x58f8f10,'column_bytes':0x58f8c00,'reset':0x58f7cb0,'stmt_busy':0x58f9f30}
WAKE={'get_coro':0x47220,'query_message':0x390bd10,'get_svc':0x381870,
      'get_contact':0x4737f0,'query_contact':0x3015dc0,
      'get_sessions':0xeb20d0,'query_sessions':0x508cea0,
      'get_sns':0x1087ac0,'query_sns':0x57088f0}

def query_database(memory,binding,path,base,database,sql,target,check):
    require(database in ('message_0.db','contact.db','session.db','sns.db'),'INVALID_DATABASE','Unsupported database')
    profile(binding);adapter=Instrument(memory,binding,path,base);raw={}
    try:
        offsets={**FUNCTIONS,**WAKE}
        config={'fixture':False,'functions':offsets,'guards':{n:adapter.guard(r) for n,r in offsets.items()},
                'handles':[],'expectedPath':database,'sql':sql,
                'wake':{'identity':list(target.encode('utf8')),'kind':{'contact.db':1,'session.db':2,'sns.db':3}.get(database,0)},
                'code':(ROOT/'native/history.c').read_text()+(ROOT/'native/read-wake.c').read_text()}
        adapter.guard(0x4a09e0)
        check();rpc=adapter.start('const config='+json.dumps(config)+';'+(ROOT/'native/history.js').read_text());check();bounded(rpc.arm)
        for _ in range(60):
            check()
            if bounded(rpc.status)[1]==2:break
            time.sleep(.5)
        raw=bounded(rpc.result)
    finally:raw['cleanup']=adapter.close()
    require(raw['cleanup'].get('unloaded') and raw['cleanup'].get('codeRestored'),'CLEANUP_FAILED','Native reader did not clean up')
    return raw
