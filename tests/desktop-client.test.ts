import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {DesktopClient} from '../src/core/desktop-client';
import type {DesktopSession} from '../src/agent/desktop-session';
test('client feedback combines measured transport counters and supplied decoder timing without fabricated encode duration',{timeout:5000},async()=>{
 class FakeSession extends EventEmitter{mediaStats={droppedFrames:1,completedFrames:3};ping(){} input(){}feedback(value:unknown){this.emit('reported',value);return true;}async close(){this.emit('closed','done');}}
 const session=new FakeSession(),client=new DesktopClient(session as unknown as DesktopSession,false);
 try{
  session.emit('video',{width:64,height:64,sourceWidth:64,sourceHeight:64,fps:30,codec:'avc1.4d001e',encoder:'fixture',hardware:false});
  session.emit('pong',{rttMs:12});session.emit('frame',{id:0n,timestamp:1000n,key:true,data:Buffer.alloc(1000)});for(let i=0;i<10;i++)client.reportDecode(4,6);client.reportDecode(500,1000);
  const [feedback]=await once(session,'reported');assert.equal(feedback.rttMs,12);assert.equal(feedback.decodeMs,4);assert.equal(feedback.queueMs,6);assert.equal(feedback.loss,.25);assert.ok(feedback.deliveredBitsPerSecond>0);assert.equal('encodeMs' in feedback,false);assert.equal(client.videoInfo?.width,64);
 }finally{await client.close();}
});
