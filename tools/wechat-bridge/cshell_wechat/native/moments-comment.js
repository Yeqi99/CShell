
const base=Process.getModuleByName('Weixin.dll').base,symbols={};
for(const[n,r]of Object.entries(config.offsets)){const p=base.add(r);if(!config.guards[n].every((b,i)=>p.add(i).readU8()===b))throw Error('CODE_CHANGED');symbols[n]=p;}
const state=Memory.alloc(12),observed=Memory.alloc(64),input=Memory.alloc(config.bytes.length+1),len=Memory.alloc(8),id=Memory.alloc(8);
state.writeByteArray(new Uint8Array(12));observed.writeByteArray(new Uint8Array(64));input.writeByteArray(config.bytes);input.add(config.bytes.length).writeU8(0);len.writeU64(config.bytes.length);id.writeU64(uint64(config.postId));
Object.assign(symbols,{state,observed,input_text:input,input_len:len,input_id:id,model_vtable:base.add(0x94e6d98),tls_index:base.add(0xbb63820)});
if(symbols.tls_index.readU32()>=64)throw Error('TLS_INDEX');
const ct=Memory.allocUtf8String(config.comment),cl=Memory.alloc(8);cl.writeU64(config.commentBytes);symbols.comment_text=ct;symbols.comment_len=cl;const cm=new CModule(config.code,symbols),hook=Interceptor.attach(symbols.get_coro,{onEnter:cm.enter});
rpc.exports={arm(){state.writeS32(1)},status(){return Array.from({length:3},(_,i)=>state.add(i*4).readS32())},result(){return Array.from({length:8},(_,i)=>observed.add(i*8).readU64().toString())},stop(){state.writeS32(0);hook.detach();return{active:state.add(8).readS32(),state:this.status()}}};
