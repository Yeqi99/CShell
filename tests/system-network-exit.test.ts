import test from 'node:test';
import assert from 'node:assert/strict';
import {systemExitConfig,linuxSystemExitGuard,SystemExitSession} from '../src/core/system-network-exit';
const input={platform:'win32' as const,proxyPort:23456,controlAddresses:['192.0.2.1']};
test('system exit has no direct outbound, DNS remote TCP and explicit UDP rejection',()=>{
 const c=systemExitConfig(input);assert.deepEqual(c.outbounds.map(x=>x.type),['http']);assert.equal(c.dns.servers[0].detour,'machine');assert.equal(c.dns.servers[0].type,'tcp');assert.equal(c.route.rules[1].action,'reject');assert.equal(c.inbounds[0].strict_route,true);
 assert.throws(()=>systemExitConfig({...input,controlAddresses:['0.0.0.0/0']}));
});
test('Linux guard never flushes unrelated policy or allows interactive UID wildcard traffic',()=>{
 const text=linuxSystemExitGuard({interfaceName:'cshelltun',controlUid:991,control:[{address:'192.0.2.1',port:24443}]});assert.match(text,/policy drop/);assert.match(text,/meta skuid 991 ip daddr 192.0.2.1 tcp dport 24443/);assert.doesNotMatch(text,/flush ruleset|ct state established/);assert.throws(()=>linuxSystemExitGuard({interfaceName:'x;drop',controlUid:0,control:[]}));
});
test('failure leaves persistent guard; explicit stop removes it only after engine shutdown',async()=>{
 const steps:string[]=[];const session=new SystemExitSession({preflight:async()=>{steps.push('preflight')},authorize:async()=>true,guardInstall:async()=>{steps.push('guard')},guardRemove:async()=>{steps.push('unguard')},engineStart:async()=>{steps.push('engine');return{ready:async()=>{throw Error('EXIT_DOWN')},stop:async()=>{steps.push('stop')}}}});
 await assert.rejects(session.start(input),/EXIT_DOWN/);assert.equal(session.status().guarded,true);assert.deepEqual(steps,['preflight','guard','engine','stop']);await session.stop();assert.equal(steps.at(-1),'unguard');
});
test('rejected system authorization never installs firewall or starts engine',async()=>{
 let changed=false;const session=new SystemExitSession({preflight:async()=>{},authorize:async()=>false,guardInstall:async()=>{changed=true},guardRemove:async()=>{},engineStart:async()=>{throw Error('unexpected')}});await assert.rejects(session.start(input),/NOT_AUTHORIZED/);assert.equal(changed,false);
});
