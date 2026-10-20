"""Explicit, bounded developer probe. Not a production send-file implementation.

Captures one type-49 message to filehelper only, using the verified send entry.
Keep output local: it includes the test attachment's path and native fields.
"""
import argparse
import json
import pathlib
import time
from cshell_wechat.windows import Memory
from cshell_wechat.runtime import Instrument, bounded, profile
from cshell_wechat.state import exclusive, state_dir

SOURCE = r'''
const base=Process.getModuleByName('Weixin.dll').base,site=base.add(config.rva);
if(!config.guard.every((b,i)=>site.add(i).readU8()===b))throw Error('CODE_CHANGED');
const storage=Memory.alloc(8192);storage.writeByteArray(new Uint8Array(8192));
const cm=new CModule(config.code,{storage,rpm:Process.getModuleByName('kernel32.dll').getExportByName('ReadProcessMemory')});
const hook=Interceptor.attach(site,{onEnter:cm.on_enter});let stopped=false;
storage.writeInt(1);
rpc.exports={
 status(){return {active:storage.add(4).readInt(),stage:storage.add(8).readInt()};},
 result(){if(storage.add(8).readInt()!==2)return null;
 const strings=[];for(let i=0;i<storage.add(16).readInt();i++){
 const p=storage.add(2048+i*272);try{strings.push({offset:p.readU32(),value:p.add(8).readUtf8String(p.add(4).readU32())});}catch(e){}
 }return {strings,snapshot:storage.add(12).readInt()?Array.from(new Uint8Array(storage.add(64).readByteArray(0x758))):null};},
 stop(){storage.writeInt(0);if(!stopped){hook.detach();stopped=true;}return this.status();}
};
'''

def main(site=0x17b3d70,scope='filehelper/type49/one-message',source=SOURCE,code_path=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid',required=True,type=int)
    parser.add_argument('--seconds',type=int,default=180,choices=range(1,301))
    parser.add_argument('--output',required=True,type=pathlib.Path)
    args=parser.parse_args()
    memory=Memory(args.pid);adapter=None;result={}
    try:
        with exclusive(state_dir()/'operation.lock'):
            binding,path,base=memory.inspect();p=profile(binding)
            if p['version']!='4.1.15.50':raise RuntimeError('UNSUPPORTED_VERSION')
            adapter=Instrument(memory,binding,path,base)
            config={'rva':site,'guard':adapter.guard(site),
                    'code':(code_path or pathlib.Path(__file__).with_suffix('.c')).read_text()}
            result={'binding':binding,'startedAt':time.time(),'scope':scope}
            try:
                rpc=adapter.start('const config='+json.dumps(config)+';'+source)
                print('READY: passive '+scope+' probe',flush=True)
                deadline=time.monotonic()+args.seconds
                while time.monotonic()<deadline:
                    state=bounded(rpc.status)
                    if state['stage']==2:
                        result['observation']=bounded(rpc.result);break
                    time.sleep(.25)
            finally:
                result['cleanup']=adapter.close()
            args.output.parent.mkdir(parents=True,exist_ok=True)
            args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
            print(json.dumps({'observed':'observation' in result,'cleanup':result['cleanup']}),flush=True)
    finally:
        memory.close()

if __name__=='__main__':main()
