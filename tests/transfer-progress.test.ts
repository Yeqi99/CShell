import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable,Writable} from 'node:stream';
import {Transfers} from '../src/core/transfers';
import {createTransferProgress,TransferMeter,formatFileBytes,transferDetail} from '../src/shared/transfer-progress';
import type {Transfer} from '../src/shared/contracts';
import type {SshService} from '../src/core/ssh';
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
test('binary file sizes remain readable and queued / unknown totals are honest',()=>{
 assert.equal(formatFileBytes(140_000_000),'133.5 MiB');
 assert.equal(formatFileBytes(0),'0 B');assert.equal(formatFileBytes(1024),'1 KiB');
 assert.equal(formatFileBytes(NaN),'—');
 const state:Transfer={id:'a',sessionId:'s',name:'a',direction:'upload',done:1024,total:1024,state:'running'};
 assert.equal(transferDetail(state),'已传输 1 KiB');
 assert.match(transferDetail({...state,totalKnown:true}),/99%/);
 assert.equal(transferDetail({...state,queued:true}),'等待传输');
});
test('average rate uses actual bytes and monotonic time and clears on failure',()=>{
 let now=10;const meter=new TransferMeter(()=>now);
 const state:Transfer={id:'a',sessionId:'s',name:'a',direction:'download',done:2048,total:4096,state:'running'};
 now=1010;meter.update(state);assert.equal(state.bytesPerSecond,2048);
 state.state='failed';meter.update(state);assert.equal(state.bytesPerSecond,undefined);
});
test('SFTP copy publishes real stream bytes and speed before rename completes',async()=>{
 const bytes=Buffer.alloc(32*1024,7);const events:Transfer[]=[];let received=0,renamed=false;
 let resolve!:(s:Transfer)=>void;const completed=new Promise<Transfer>(r=>resolve=r);
 const source={lstat:(_:string,cb:Function)=>cb(null,{size:bytes.length*4,isSymbolicLink:()=>false,isDirectory:()=>false,isFile:()=>true}),createReadStream:()=>Readable.from((async function*(){for(let i=0;i<4;i++){await delay(120);yield bytes;}})())};
 const target={lstat:(_:string,cb:Function)=>cb({code:2}),createWriteStream:()=>new Writable({write(chunk,_,cb){received+=chunk.length;cb();}}),rename:(_:string,__:string,cb:Function)=>{assert.equal(received,bytes.length*4);renamed=true;cb();},unlink:(_:string,cb:Function)=>cb()};
 const transfers=new Transfers({sftp:async(id:string)=>id==='source'?source:target} as unknown as SshService,s=>{events.push(s);if(s.state!=='running')resolve(s);},async()=>false);
 transfers.copyRemote('source','/a','target','/b');
 const last=await completed;assert.equal(last.state,'done');assert.equal(last.done,received);assert.equal(last.total,received);assert.equal(renamed,true);
 const partial=events.filter(e=>e.done>0&&e.done<received);assert.ok(partial.length>=2);assert.ok(partial.some(e=>(e.bytesPerSecond||0)>0));assert.equal(last.bytesPerSecond,undefined);assert.ok(events[0].queued);
});
test('operation publishers (FTP path) also calculate rate from provider counters',async()=>{
 let resolve!:(s:Transfer)=>void;const completed=new Promise<Transfer>(r=>resolve=r);const events:Transfer[]=[];
 const transfers=new Transfers({} as SshService,s=>{events.push(s);if(s.state!=='running')resolve(s);},async()=>false);
 transfers.enqueueOperation('ftp','file',async(state,_,publish)=>{state.total=4096;state.totalKnown=true;await delay(110);state.done=1024;publish();await delay(110);state.done=4096;publish();});
 assert.equal((await completed).done,4096);assert.ok(events.some(e=>e.done===1024&&(e.bytesPerSecond||0)>0));
});

test('CAgent chunk progress is throttled but terminal event retains exact bytes and status',()=>{
 let clock=0;const events:Transfer[]=[];
 const tracker=createTransferProgress('id','target','file','download',s=>events.push(s),()=>clock);
 clock=100;tracker.update(1000,5000,true);clock=150;tracker.update(2000,5000,true);
 assert.equal(events.length,2);assert.equal(events[1].done,1000);assert.equal(events[1].bytesPerSecond,10000);
 tracker.finish('cancelled');assert.equal(events.at(-1)!.done,2000);assert.equal(events.at(-1)!.state,'cancelled');assert.equal(events.at(-1)!.bytesPerSecond,undefined);
 const batch=createTransferProgress('batch','target','batch','upload',s=>events.push(s),()=>clock);
 batch.update(3000,0,false);batch.finish('done');assert.equal(events.at(-1)!.total,3000);assert.equal(events.at(-1)!.totalKnown,true);
});
