import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { MediaSender,MediaReceiver,DesktopAdaptation,desktopPercentile } from '../src/agent/desktop-media';

test('media authenticates every fragment, reorders, rejects replay and forged headers',()=>{
 const key=randomBytes(32),session=randomBytes(8),sender=new MediaSender(key,session),receiver=new MediaReceiver(key,session);
 const data=randomBytes(12000),packets=sender.encode({id:0n,timestamp:100n,key:true,data});
 const forged=Buffer.from(packets[0]);forged[10]=0xff;assert.equal(receiver.accept(forged,0),undefined);
 let result;for(const p of [...packets].reverse())result=receiver.accept(p,1)??result;
 assert.deepEqual(result?.data,data);assert.equal(result?.timestamp,100n);
 for(const p of packets)assert.equal(receiver.accept(p,2),undefined);
 assert.equal(receiver.stats.completedFrames,1);
 assert.equal(new MediaReceiver(randomBytes(32),session).accept(packets[0]),undefined);
 assert.equal(new MediaReceiver(key,randomBytes(8)).accept(packets[0]),undefined);
});
test('loss discards incomplete frame and predictive descendants until a new keyframe',()=>{
 const key=randomBytes(32),session=randomBytes(8),sender=new MediaSender(key,session),receiver=new MediaReceiver(key,session,4096,100);
 const frame=(id:bigint,key:boolean,n=2000)=>sender.encode({id,timestamp:100n,key,data:Buffer.alloc(n,42)});
 const first=frame(0n,true);assert.equal(receiver.accept(first[0],0),undefined);receiver.expire(101);assert.equal(receiver.needsKeyframe,true);
 for(const p of frame(1n,false))assert.equal(receiver.accept(p,102),undefined);
 let restored;for(const p of frame(2n,true))restored=receiver.accept(p,103)??restored;
 assert.equal(restored?.id,2n);assert.equal(receiver.needsKeyframe,false);
 // Missing an entire frame must invalidate prediction too.
 for(const p of frame(4n,false))assert.equal(receiver.accept(p,104),undefined);
 assert.equal(receiver.needsKeyframe,true);
 for(const p of first)assert.equal(receiver.accept(p,105),undefined);
});
test('receiver memory is bounded, newer frames supersede stalled assemblies',()=>{
 const key=randomBytes(32),session=randomBytes(8),sender=new MediaSender(key,session),receiver=new MediaReceiver(key,session,2000);
 for(const p of sender.encode({id:0n,timestamp:0n,key:true,data:Buffer.alloc(3000)}))assert.equal(receiver.accept(p,0),undefined);
 const result=receiver.accept(sender.encode({id:1n,timestamp:1n,key:true,data:Buffer.alloc(20)})[0],1);
 assert.equal(result?.data.length,20);assert.ok(receiver.stats.droppedFrames>=1);
});
test('quality drops quickly and recovers slowly up to actual requested capability, no 60fps ceiling',()=>{
 const quality={fps:144,bitrate:80000000,scale:1},adapt=new DesktopAdaptation({...quality},quality);
 const good={rttMs:10,jitterMs:1,loss:0,queueMs:1,encodeMs:2,decodeMs:2,deliveredBitsPerSecond:100000000};
 adapt.update({...good,loss:.2,queueMs:200,deliveredBitsPerSecond:2000000},0);assert.equal(adapt.current.bitrate,60000000);assert.ok(adapt.current.fps<144);
 const low={...adapt.current};for(let i=0;i<3;i++)adapt.update(good,(i+1)*2000);assert.deepEqual(adapt.current,low);
 adapt.update(good,8000);assert.ok(adapt.current.bitrate>low.bitrate);assert.ok(adapt.current.bitrate<quality.bitrate);
 for(let i=0;i<500;i++)adapt.update(good,10000+i*2000);assert.equal(adapt.current.fps,144);assert.equal(adapt.current.bitrate,quality.bitrate);
 assert.throws(()=>adapt.update({...good,loss:NaN}));
});

const healthy={rttMs:12,jitterMs:2,loss:0,queueMs:3,encodeMs:8,decodeMs:2,deliveredBitsPerSecond:1000};
test('unlimited probes real headroom beyond starting rate without inflating static-content bitrate',()=>{
 const initial={fps:60,bitrate:12000000,scale:1},adapt=new DesktopAdaptation({...initial},initial,true);
 for(let i=0;i<8;i++)adapt.update({...healthy,encodeMs:2},i*2000);
 assert.ok(adapt.current.fps>60);assert.equal(adapt.current.bitrate,12000000);
 for(let i=0;i<8;i++)adapt.update({...healthy,encodeMs:2,deliveredBitsPerSecond:adapt.current.bitrate*.8},20000+i*2000);
 assert.ok(adapt.current.bitrate>12000000);
 const before={...adapt.current};adapt.update({...healthy,loss:.4,queueMs:500},50000);
 assert.ok(adapt.current.bitrate<before.bitrate);assert.ok(adapt.current.fps<before.fps);
});
test('static content goodput and isolated IPC/encoder spikes never collapse quality',()=>{
 const desired={fps:60,bitrate:12000000,scale:1},adapt=new DesktopAdaptation({...desired},desired);
 for(let i=0;i<20;i++)adapt.update({...healthy,...(i===5?{queueMs:90,encodeMs:90}:{} )},i*2000);
 assert.deepEqual(adapt.current,desired);
 assert.equal(desktopPercentile([2,3,3,4,5,900]),4);
});
test('sustained compute reduces rate without treating parallel encode/decode as serial or slashing bitrate',()=>{
 const desired={fps:60,bitrate:12000000,scale:1},adapt=new DesktopAdaptation({...desired},desired);
 adapt.update({...healthy,encodeMs:15,decodeMs:15},0);adapt.update({...healthy,encodeMs:15,decodeMs:15},2000);assert.equal(adapt.current.fps,60);
 adapt.update({...healthy,processingMs:30},4000);assert.equal(adapt.current.fps,60);
 adapt.update({...healthy,processingMs:30},6000);assert.ok(Math.abs(adapt.current.fps-30)<1e-9);assert.equal(adapt.current.bitrate,12000000);assert.equal(adapt.current.scale,1);
});
test('severe congestion reacts immediately but bounded change cadence prevents restart storms; scale recovers independently',()=>{
 const desired={fps:60,bitrate:12000000,scale:1},adapt=new DesktopAdaptation({...desired},desired);
 adapt.update({...healthy,loss:.3},0);const initial={...adapt.current};adapt.update({...healthy,loss:.3},500);assert.deepEqual(adapt.current,initial);
 adapt.update({...healthy,loss:.3},2000);assert.ok(adapt.current.bitrate<initial.bitrate);
 const scaled=new DesktopAdaptation({...desired,scale:.5},desired);for(let i=0;i<4;i++)scaled.update(healthy,i*2000);assert.ok(scaled.current.scale>.5);assert.equal(scaled.current.bitrate,desired.bitrate);assert.equal(scaled.current.fps,desired.fps);
});

