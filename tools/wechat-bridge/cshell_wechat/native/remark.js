const base=Process.getModuleByName('Weixin.dll').base,symbols={},keep=[];
for(const [n,r] of Object.entries(config.offsets)){
 const p=base.add(r);
 if(!config.guards[n].every((b,i)=>p.add(i).readU8()===b))throw Error('CODE_CHANGED');
 symbols[n]=p;
}
function str(bytes){
 const p=Memory.alloc(32);p.writeByteArray(new Uint8Array(32));
 if(bytes.length<16){p.writeByteArray(bytes);p.add(24).writeU64(15);}
 else{const t=Memory.alloc(bytes.length+1);t.writeByteArray([...bytes,0]);keep.push(t);p.writePointer(t);p.add(24).writeU64(bytes.length);}
 p.add(16).writeU64(bytes.length);keep.push(p);return p;
}
const state=Memory.alloc(24);state.writeByteArray(new Uint8Array(24));
const before=Memory.alloc(129),mode=Memory.alloc(4);before.writeByteArray(new Uint8Array(129));mode.writeS32(config.write?1:0);
Object.assign(symbols,{state,tls_index:base.add(0xbb63820),identity:str(config.identity),remark:str(config.remark),expected:str(config.expected),before_text:before,write_mode:mode});
if(symbols.tls_index.readU32()>=64)throw Error('TLS_INDEX');
const cm=new CModule(config.code,symbols),hook=Interceptor.attach(symbols.get_coro,{onEnter:cm.enter});
rpc.exports={result(){return {state:this.status(),previousRemark:before.readUtf8String()};},arm(){state.writeS32(1)},status(){return Array.from({length:6},(_,i)=>state.add(i*4).readS32())},
 stop(){state.writeS32(0);hook.detach();return {active:state.add(8).readS32(),state:this.status()}}};
