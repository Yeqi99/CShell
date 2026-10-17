const base=Process.getModuleByName('Weixin.dll').base,site=base.add(config.rva);
if(!config.guard.every((b,i)=>site.add(i).readU8()===b))throw Error('CODE_CHANGED');
const storage=Memory.alloc(32+32*4608);storage.writeByteArray(new Uint8Array(32+32*4608));
const targets=Memory.alloc(128*config.allowed.length);targets.writeByteArray(new Uint8Array(128*config.allowed.length));
config.allowed.forEach((v,i)=>targets.add(i*128).writeUtf8String(v));
const count=Memory.alloc(4);count.writeInt(config.allowed.length);
const cm=new CModule(config.nativeCode,{storage,targets,target_count:count,rpm:Process.getModuleByName('kernel32.dll').getExportByName('ReadProcessMemory')});
const take=new NativeFunction(cm.take,'int',['pointer']);const output=Memory.alloc(4608);
storage.add(4).writeInt(1);
const hook=Interceptor.attach(site,{onEnter:cm.on_enter});let stopped=false;
rpc.exports={
 drain(){const events=[];let decodeErrors=0;for(let i=0;i<32&&take(output);i++){
  try{events.push({messageId:output.readU64().toString(),timestamp:output.add(8).readU64().toString(),type:output.add(16).readU32(),from:output.add(32).readUtf8String(),to:output.add(160).readUtf8String(),member:output.add(288).readUtf8String(),text:output.add(416).readUtf8String(output.add(20).readInt())})}catch(e){decodeErrors++;}
 }return {events,hits:storage.add(12).readInt(),errors:storage.add(16).readInt(),dropped:storage.add(20).readInt(),decodeErrors,active:storage.add(8).readInt()};},
 stop(){storage.add(4).writeInt(0);if(!stopped){hook.detach();stopped=true;}return {active:storage.add(8).readInt()};}
};
