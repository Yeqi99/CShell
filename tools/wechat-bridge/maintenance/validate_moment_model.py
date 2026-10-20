"""Reconstruct one exact cached post without commenting, liking, or publishing."""
import argparse,json,pathlib,time,xml.etree.ElementTree as ET
from cshell_wechat.windows import Memory
from cshell_wechat.runtime import Instrument,bounded,profile
from cshell_wechat.database_read import query_database
from cshell_wechat.state import exclusive,state_dir
from cshell_wechat.contracts import require

OFFSETS={'get_coro':0x47220,'alloc':0x7524b2c,'parse':0x438dfb0,'valid':0x4390fe0}
SOURCE=r'''
const base=Process.getModuleByName('Weixin.dll').base,symbols={};
for(const[n,r]of Object.entries(config.offsets)){const p=base.add(r);if(!config.guards[n].every((b,i)=>p.add(i).readU8()===b))throw Error('CODE_CHANGED');symbols[n]=p;}
const state=Memory.alloc(12),observed=Memory.alloc(40),input=Memory.alloc(config.bytes.length+1),len=Memory.alloc(8),id=Memory.alloc(8);
state.writeByteArray(new Uint8Array(12));observed.writeByteArray(new Uint8Array(40));input.writeByteArray(config.bytes);input.add(config.bytes.length).writeU8(0);len.writeU64(config.bytes.length);id.writeU64(uint64(config.postId));
Object.assign(symbols,{state,observed,input_text:input,input_len:len,input_id:id,model_vtable:base.add(0x94e6d98),tls_index:base.add(0xbb63820)});
if(symbols.tls_index.readU32()>=64)throw Error('TLS_INDEX');
const cm=new CModule(config.code,symbols),hook=Interceptor.attach(symbols.get_coro,{onEnter:cm.enter});
rpc.exports={arm(){state.writeS32(1)},status(){return Array.from({length:3},(_,i)=>state.add(i*4).readS32())},result(){return Array.from({length:5},(_,i)=>observed.add(i*8).readU64().toString())},stop(){state.writeS32(0);hook.detach();return{active:state.add(8).readS32(),state:this.status()}}};
'''

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--pid',type=int,required=True);parser.add_argument('--post-id',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    require(args.post_id.isdecimal() and 0<int(args.post_id)<2**64,'INVALID_ID','Exact post ID required')
    memory=Memory(args.pid);result={}
    try:
        binding,path,base=memory.inspect();profile(binding)
        require(binding['moduleSha256']=='0cf6379405432385a1c442766443450f26a7689f45e53c1b4ad2822061f3113b','UNSUPPORTED_VERSION','Exact build required')
        with exclusive(state_dir()/'operation.lock'):
            tid=int(args.post_id);signed=tid if tid<2**63 else tid-2**64
            columns=['length(CAST(content AS BLOB))']+[f'hex(substr(CAST(content AS BLOB),{i*3500+1},3500))' for i in range(7)]
            raw=query_database(memory,binding,path,base,'sns.db',f"SELECT {','.join(columns)} FROM SnsTimeLine WHERE tid={signed} LIMIT 1",'filehelper',lambda:None)
            print(json.dumps({'readState':raw['state'],'matchingRows':len(raw['rows'])}),flush=True)
            require(raw['state'][1]==2 and raw['state'][3]==101 and len(raw['rows'])==1,'POST_NOT_FOUND','One complete cached post required')
            row=raw['rows'][0];require(0<int(row[0])<=24500,'INVALID_XML','Bounded cached XML required')
            data=bytes.fromhex(''.join(row[1:]));require(len(data)==int(row[0]),'INVALID_XML','Incomplete XML')
            xml=data.decode('utf8');require('<!DOCTYPE' not in xml and '<!ENTITY' not in xml,'INVALID_XML','Declarations not supported')
            root=ET.fromstring(xml);obj=root if root.tag=='TimelineObject' else root.find('TimelineObject')
            require(obj is not None and obj.findtext('id')==args.post_id,'POST_MISMATCH','Cached server ID must match')
            extra=root.find('LocalExtraInfo')
            if extra is not None:
                print(json.dumps({'listStructure':{n.tag:[{'tag':c.tag,'fields':[d.tag for d in c]} for c in list(n)[:1]] for n in extra if n.tag.endswith('_list')}}),flush=True)
            adapter=Instrument(memory,binding,path,base)
            try:
                config={'offsets':OFFSETS,'guards':{k:adapter.guard(v) for k,v in OFFSETS.items()},'bytes':list(xml.encode()),'postId':args.post_id,'code':pathlib.Path(__file__).with_suffix('.c').read_text()}
                adapter.guard(0x4a09e0)
                rpc=adapter.start('const config='+json.dumps(config)+';'+SOURCE);bounded(rpc.arm)
                for _ in range(60):
                    state=bounded(rpc.status)
                    if state[1]==2:break
                    time.sleep(.5)
                result={'state':state,'observed':bounded(rpc.result),'writesPerformed':False}
            finally:result['cleanup']=adapter.close()
    finally:memory.close()
    pathlib.Path(args.output).write_text(json.dumps(result),encoding='utf8');print(json.dumps(result))

if __name__=='__main__':main()
