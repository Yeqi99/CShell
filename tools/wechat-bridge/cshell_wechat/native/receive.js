const base = Process.getModuleByName('Weixin.dll').base;
const site = base.add(config.rva);
if (!config.guard.every((v,i)=>site.add(i).readU8()===v)) throw Error('CODE_CHANGED');
let queue=[], dropped=0, hits=0, errors=0;
const allowed = new Set(config.allowed);
function str(p,max) {
  const n=p.add(16).readU64().toNumber(),cap=p.add(24).readU64().toNumber();
  if(n===0 && cap===15) return '';
  if(n<0 || n>max || cap<n || cap>1048576) throw Error('STRING_BOUND');
  return (cap<16?p:p.readPointer()).readUtf8String(n);
}
const hook = Interceptor.attach(site,{onEnter(args){
  hits++;
  try {
    const begin=args[1].readPointer(),end=args[1].add(8).readPointer();
    if(begin.isNull()) return;
    const length=end.sub(begin).toInt32();
    if(length<0 || length>0x2e8*64 || length%0x2e8!==0) return;
    for(let off=0;off<length;off+=0x2e8){
      try {
        const m=begin.add(off),from=str(m.add(0x18),128),to=str(m.add(0x38),128);
        const room=[from,to].find(x=>x.endsWith('@chatroom'));
        if(room ? !allowed.has(room) : !allowed.has(from) && !allowed.has(to)) continue;
        // Identity filter precedes message-body reads. No media dereferencing or XML execution.
        const event={from,to,member:str(m.add(0x58),128),type:m.add(12).readU32(),
          messageId:m.add(0x148).readU64().toString(),timestamp:m.add(0x150).readU64().toString(),
          text:str(m.add(0x180),16384)};
        if(queue.length===256){queue.shift();dropped++;}
        queue.push(event);
      }catch(e){errors++;}
    }
  }catch(e){errors++;}
}});
rpc.exports={drain(){const events=queue;queue=[];return {events,dropped,hits,errors}},stop(){hook.detach();return true}};
