const symbols={},base=config.fixture?null:Process.getModuleByName('Weixin.dll').base;
for(const [name,value] of Object.entries(config.functions)){
 const p=config.fixture?ptr(value):base.add(value);
 if(!config.guards[name].every((b,i)=>p.add(i).readU8()===b))throw Error('CODE_CHANGED');
 symbols[name==='finalize'?'sql_finalize':name]=p;
}
const control=Memory.alloc(32),output=Memory.alloc(65536),handles=Memory.alloc(Math.max(8,config.handles.length*8)),count=Memory.alloc(4);
symbols.selected_path=Memory.alloc(1024);symbols.selected_path.writeByteArray(new Uint8Array(1024));
if(config.expectedPath)config.code='#define MATCH_PATH 1\n'+config.code;
symbols.expected_path=Memory.allocUtf8String(config.expectedPath||'');
control.writeByteArray(new Uint8Array(32));count.writeS32(config.handles.length);
config.handles.forEach((h,i)=>handles.add(i*8).writePointer(ptr(h)));
Object.assign(symbols,{control,output,handles,handle_count:count,query:Memory.allocUtf8String(config.sql),tick:Process.getModuleByName('kernel32.dll').getExportByName('GetTickCount64')});
const wakeState=Memory.alloc(12);wakeState.writeByteArray(new Uint8Array(12));
const keep=[];
if(config.wake){
 const id=Memory.alloc(32),bytes=config.wake.identity;id.writeByteArray(new Uint8Array(32));
 if(bytes.length<16){id.writeByteArray(bytes);id.add(24).writeU64(15);}
 else{const text=Memory.alloc(bytes.length+1);text.writeByteArray([...bytes,0]);keep.push(text);id.writePointer(text);id.add(24).writeU64(bytes.length);}
 id.add(16).writeU64(bytes.length);keep.push(id);
 const kind=Memory.alloc(4);kind.writeS32(config.wake.kind);keep.push(kind);
 Object.assign(symbols,{wake_state:wakeState,identity:id,wake_kind:kind,tls_index:base.add(0xbb63820)});
 if(symbols.tls_index.readU32()>=64)throw Error('TLS_INDEX');
}
const cm=new CModule(config.code,symbols),hook=Interceptor.attach(symbols.reset,{onEnter:cm.enter}),finalizeHook=Interceptor.attach(symbols.sql_finalize,{onEnter:cm.enter});
const wakeHook=config.wake?Interceptor.attach(symbols.get_coro,{onEnter:cm.wake}):null;
rpc.exports={arm(){control.writeS32(1);if(wakeHook)wakeState.writeS32(1)},status(){return Array.from({length:8},(_,i)=>control.add(i*4).readS32())},result(){
 const rows=[],n=control.add(16).readS32(),bytes=control.add(20).readS32();let at=0;
 for(let r=0;r<n;r++){
  if(at+4>bytes)throw Error('BOUND');const cols=output.add(at).readS32();at+=4;const row=[];
  for(let c=0;c<cols;c++){if(at+4>bytes)throw Error('BOUND');const len=output.add(at).readS32();at+=4;if(len>=0){if(at+len>bytes)throw Error('BOUND');row.push(output.add(at).readUtf8String(len));at+=len;}else row.push(null);}
  rows.push(row);
 }return {rows,state:this.status(),wakeState:Array.from({length:3},(_,i)=>wakeState.add(i*4).readS32()),databasePath:symbols.selected_path.readUtf8String()};
},stop(){control.writeS32(0);wakeState.writeS32(0);if(wakeHook)wakeHook.detach();hook.detach();finalizeHook.detach();return {active:control.add(8).readS32()+wakeState.add(8).readS32()};}};
