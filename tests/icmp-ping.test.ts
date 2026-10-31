import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parsePingOutput, pingResult, pingHost } from '../src/core/icmp-ping';
import { registerNetworkDiagnostics } from '../src/desktop/network-diagnostics';

test('ICMP parses reply timing, preserves less-than and ignores unreachable summaries', () => {
 assert.deepEqual(parsePingOutput('Reply from 127.0.0.1: bytes=32 time<1ms TTL=128'), { elapsedMs:1, lessThan:true });
 assert.deepEqual(parsePingOutput('64 bytes from localhost: icmp_seq=1 ttl=64 time=0.031 ms'), { elapsedMs:0.031, lessThan:false });
 assert.deepEqual(parsePingOutput('来自 127.0.0.1 的回复: 字节=32 时间<1ms TTL=128'), { elapsedMs:1, lessThan:true });
 assert.equal(parsePingOutput('Destination host unreachable. Average = 0ms'), null);
 assert.equal(pingResult(Object.assign(new Error('missing'),{code:'ENOENT'}),'',0).status,'unsupported');
 assert.equal(pingResult(Object.assign(new Error('timeout'),{code:'ETIMEDOUT'}),'time=12 ms',0).status,'unreachable');
 assert.equal(pingResult(null,'Destination host unreachable',0).elapsedMs,null);
});

test('real loopback ICMP produces an actual sample', async () => {
 const result=await pingHost('127.0.0.1');
 assert.equal(result.status,'reply');assert.equal(result.method,'icmp');assert.ok(result.elapsedMs!>=0);
});

test('IPC only pings selected stored/active targets, bounds duplicate work and rejects arbitrary hosts', async () => {
 const handlers=new Map<string,(...args:any[])=>any>();
 const id=randomUUID();const profile={id,host:'127.0.0.1',protocol:'ssh'};
 registerNetworkDiagnostics((key,fn)=>handlers.set(key,fn), {profile:(requested:string)=>{assert.equal(requested,id);return profile;}} as any,
 {get:(session:string)=>{assert.equal(session,'live');return {profile};}} as any,{} as any,{} as any);
 const ping=handlers.get('network:ping')!;
 await assert.rejects(ping({host:'8.8.8.8'}));
 await assert.rejects(ping({profileId:id,sessionId:'live'}));
 const pending=ping({profileId:id});await assert.rejects(ping({sessionId:'live'}),/正在进行/);
 assert.equal((await pending).status,'reply');assert.equal((await ping({sessionId:'live'})).status,'reply');
});
import { classifyPingRoute } from '../src/core/icmp-ping';
test('selected route protects against synthetic ICMP without guessing from RTT', () => {
 assert.equal(classifyPingRoute('199.102.219.30',{interfaceAlias:'Meta',sourceAddress:'198.18.0.0',nextHop:'198.18.0.1'}),'proxy-path');
 assert.equal(classifyPingRoute('192.168.31.210',{interfaceAlias:'WLAN',sourceAddress:'192.168.31.29',nextHop:'0.0.0.0'}),'direct');
 assert.equal(classifyPingRoute('199.102.219.30',{interfaceAlias:'Ethernet',sourceAddress:'10.41.81.52',nextHop:'10.41.81.1'}),'direct');
 assert.equal(classifyPingRoute('127.0.0.1',null),'direct');
 assert.equal(classifyPingRoute('::1',null),'direct');
 assert.equal(classifyPingRoute('198.18.1.3',null),'proxy-path');
 assert.equal(classifyPingRoute('199.102.219.30',null),'route-unknown');
 assert.equal(classifyPingRoute('199.102.219.30',{interfaceAlias:'VPN',interfaceDescription:'Wintun Userspace Tunnel'}),'proxy-path');
});
