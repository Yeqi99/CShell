"""Bounded XWeb observation; only sanitized JSON shape leaves probe memory."""
import argparse,json,pathlib,time
from cshell_wechat.windows import Memory
from cshell_wechat.runtime import Instrument,bounded,profile
from cshell_wechat.state import exclusive,state_dir

def main():
    p=argparse.ArgumentParser();p.add_argument('--pid',type=int,required=True);p.add_argument('--output',type=pathlib.Path,required=True);p.add_argument('--seconds',type=int,default=60,choices=range(1,121));a=p.parse_args()
    memory=Memory(a.pid);instrument=None;result={}
    try:
        with exclusive(state_dir()/'operation.lock'):
            binding,path,base=memory.inspect()
            if profile(binding)['version']!='4.1.15.50':raise RuntimeError('UNSUPPORTED_VERSION')
            instrument=Instrument(memory,binding,path,base)
            config={'guard':instrument.guard(0x935b60),'callbackGuard':instrument.guard(0x3690eb0),'code':pathlib.Path(__file__).with_suffix('.c').read_text()}
            source='const config='+json.dumps(config)+';'+r'''
const site=Process.getModuleByName('Weixin.dll').base.add(0x935b60);
if(!config.guard.every((b,i)=>site.add(i).readU8()===b))throw Error('CODE_CHANGED');
const callbackSite=Process.getModuleByName('Weixin.dll').base.add(0x3690eb0);
if(!config.callbackGuard.every((b,i)=>callbackSite.add(i).readU8()===b))throw Error('CODE_CHANGED');
const storage=Memory.alloc(64+64*16480);storage.writeByteArray(new Uint8Array(64+64*16480));
const cm=new CModule(config.code,{storage,rpm:Process.getModuleByName('kernel32.dll').getExportByName('ReadProcessMemory')});
const hook=Interceptor.attach(site,{onEnter:cm.on_enter});
const callbackHook=Interceptor.attach(callbackSite,{onEnter:cm.on_callback});storage.writeInt(1);let stopped=false;
rpc.exports={stop(){storage.writeInt(0);if(!stopped){hook.detach();callbackHook.detach();stopped=true;}return {active:storage.add(4).readInt()};},result(){
const shape=(v,depth=0,key='')=>{
 if(depth>7)return 'depth-limit';
 if(typeof v==='string'){
   if(['func','method','api','apiName','event','eventName','function'].includes(key)&&/^[A-Za-z_][A-Za-z0-9_.:]{0,79}$/.test(v))return {name:v};
   if(['msg','req_json'].includes(key)){try{return shape(JSON.parse(v),depth+1);}catch{}}
   if(key==='req_json'&&v.includes('=')){
     const keys=v.split('&').slice(0,96).map(part=>{try{return decodeURIComponent(part.split('=')[0]);}catch{return '';}}).filter(k=>/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k));
     return {encoding:'form-candidate',fields:[...new Set(keys)]};
   }
   // Persist only the public CGI route, never URL queries, article IDs or tokens.
   if(key==='url'){
     const m=/^https:\/\/mp\.weixin\.qq\.com(\/mp\/[A-Za-z_]+)(?:[?#]|$)/.exec(v);
     if(m){const query=v.split('?')[1]||'';return {route:m[1],queryFields:[...new Set(query.split('&').map(p=>p.split('=')[0]).filter(k=>/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)))]};}
   }
   return 'string';
 }
 if(Array.isArray(v))return {array:v.length,first:v.length?shape(v[0],depth+1):null};
 if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).slice(0,48).filter(k=>/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)).map(k=>[k,shape(v[k],depth+1,k)]));
 return v===null?'null':typeof v;
};
const count=Math.min(64,storage.add(8).readInt());return Array.from({length:count},(_,i)=>{const p=storage.add(64+i*16480);let structure='unavailable';const n=p.add(80).readU32();if(n){try{let raw=p.add(96).readUtf8String(n);const prefix='WeixinJSBridge._handleMessageFromWeixin(';if(raw.startsWith(prefix))raw=raw.slice(prefix.length).replace(/\);?\s*$/,'');structure=shape(JSON.parse(raw));}catch{structure='not-json';}p.add(96).writeByteArray(new Uint8Array(n));}return {context:p.readU32(),bytes:p.add(4).readU32(),command:p.add(8).readUtf8String(),structure};});}};
'''
            result={'binding':binding,'rawPayloadPersisted':False}
            try:
                rpc=instrument.start(source);print('READY: article dispatch sanitized structure only',flush=True)
                time.sleep(a.seconds)
                deadline=time.monotonic()+5
                while bounded(rpc.stop).get('active',0):
                    if time.monotonic()>=deadline:raise RuntimeError('CALLBACK_ACTIVE')
                    time.sleep(.05)
                result['commands']=bounded(rpc.result)
            finally:
                result['cleanup']=instrument.close()
                a.output.parent.mkdir(parents=True,exist_ok=True)
                a.output.write_text(json.dumps(result,indent=2),encoding='utf-8')
                print(json.dumps(result),flush=True)
                while result['cleanup'].get('retained'):
                    time.sleep(1)
                    result['cleanup']=instrument.close()
                    a.output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    finally:memory.close()

if __name__=='__main__':main()
