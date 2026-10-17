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
const cm=new CModule(config.code,symbols),hook=Interceptor.attach(symbols.reset,{onEnter:cm.enter}),finalizeHook=Interceptor.attach(symbols.sql_finalize,{onEnter:cm.enter});
rpc.exports={arm(){control.writeS32(1)},status(){return Array.from({length:8},(_,i)=>control.add(i*4).readS32())},result(){
 const rows=[],n=control.add(16).readS32(),bytes=control.add(20).readS32();let at=0;
 for(let r=0;r<n;r++){
  if(at+4>bytes)throw Error('BOUND');const cols=output.add(at).readS32();at+=4;const row=[];
  for(let c=0;c<cols;c++){if(at+4>bytes)throw Error('BOUND');const len=output.add(at).readS32();at+=4;if(len>=0){if(at+len>bytes)throw Error('BOUND');row.push(output.add(at).readUtf8String(len));at+=len;}else row.push(null);}
  rows.push(row);
 }return {rows,state:this.status(),databasePath:symbols.selected_path.readUtf8String()};
},stop(){control.writeS32(0);hook.detach();finalizeHook.detach();return {active:control.add(8).readS32()};}};
