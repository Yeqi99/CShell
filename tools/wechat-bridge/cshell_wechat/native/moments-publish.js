
const base=Process.getModuleByName('Weixin.dll').base,symbols={};
for(const[n,r]of Object.entries(config.offsets)){const p=base.add(r);if(!config.guards[n].every((b,i)=>p.add(i).readU8()===b))throw Error('CODE_CHANGED');symbols[n]=p;}
const state=Memory.alloc(24),xml=Memory.alloc(4096),observed=Memory.alloc(64),input=Memory.alloc(config.bytes.length+1),len=Memory.alloc(8);
state.writeByteArray(new Uint8Array(24));observed.writeByteArray(new Uint8Array(64));xml.writeByteArray(new Uint8Array(4096));input.writeByteArray(config.bytes);len.writeU64(config.bytes.length);
Object.assign(symbols,{state,observed,xml_out:xml,input_text:input,input_len:len,model_vtable:base.add(0x9368ba8),tls_index:base.add(0xbb63820)});
if(symbols.tls_index.readU32()>=64)throw Error('TLS_INDEX');
const cm=new CModule(config.code,symbols),hook=Interceptor.attach(symbols.get_coro,{onEnter:cm.enter});
rpc.exports={arm(){state.writeS32(1)},status(){return Array.from({length:6},(_,i)=>state.add(i*4).readS32())},result(){return Array.from({length:8},(_,i)=>observed.add(i*8).readU64().toString())},xml(){return xml.readUtf8String()},stop(){state.writeS32(0);hook.detach();return{active:state.add(8).readS32(),state:this.status()}}};
