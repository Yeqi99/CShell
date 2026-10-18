const base=Process.getModuleByName('Weixin.dll').base,symbols={},keep=[];
for(const [n,r] of Object.entries(config.offsets)){
 const p=base.add(r);
 if(!config.guards[n].every((b,i)=>p.add(i).readU8()===b))throw Error('CODE_CHANGED');
 symbols[n]=p;
}
function str(value){
 const p=Memory.alloc(32);p.writeByteArray(new Uint8Array(32));
 if(!value)p.add(24).writeU64(15);
 else{const t=Memory.allocUtf8String(value);keep.push(t);p.writePointer(t);p.add(16).writeU64(value.length);p.add(24).writeU64(value.length);}
 keep.push(p);return p;
}
const state=Memory.alloc(24);state.writeByteArray(new Uint8Array(24));
Object.assign(symbols,{state,tls_index:base.add(0xbb63820),identity:str(config.identity),ticket:str(config.ticket),empty:str('')});
if(symbols.tls_index.readU32()>=64)throw Error('TLS_INDEX');
const cm=new CModule(config.code,symbols),hook=Interceptor.attach(symbols.get_coro,{onEnter:cm.enter});
rpc.exports={arm(){state.writeS32(1)},status(){return Array.from({length:6},(_,i)=>state.add(i*4).readS32())},
 stop(){state.writeS32(0);hook.detach();return {active:state.add(8).readS32(),state:this.status()}}};
