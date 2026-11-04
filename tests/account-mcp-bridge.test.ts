import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AccountMcpBridge} from '../src/core/account-mcp-bridge';

test('account bridge preserves caller and machine-session ownership',async()=>{
  const account='a'.repeat(32),clientId=randomUUID(),sessionId=randomUUID();
  const operations:string[]=[];
  const replies:any[]=[];
  let enabled=true;
  const cloud={accountId:()=>account,accountRequest:async(path:string,body:unknown)=>{replies.push({path,body});return {ok:true};}};
  const mcp={status:()=>({running:true,settings:{enabled:true,port:3777,accountBridge:enabled?{clientId}:undefined}}),accountBridgeCall:async(id:string,consumer:string,name:string)=>{assert.equal(id,clientId);assert.ok(['alice','bob'].includes(consumer));operations.push(name);return name==='connect'?{sessionId}:{answer:'authorized result'};}};
  const bridge=new AccountMcpBridge('',{} as any,cloud as any,()=>mcp as any);
  const registration={bridgeId:randomUUID(),secret:'s'.repeat(43)};
  const invoke=(name:string,consumer:string,args:unknown)=> (bridge as any).execute({id:'1'.repeat(48),name,consumer,arguments:args},account,clientId,registration);
  try {
    await invoke('connect','alice',{profileId:randomUUID()});
    assert.equal(replies.at(-1).body.result.ok,true);
    await invoke('invoke_connection','bob',{sessionId,tool:'execute_command',arguments:{command:'echo unexpected'}});
    assert.equal(replies.at(-1).body.result.ok,false);
    assert.deepEqual(operations,['connect']);
    await invoke('invoke_connection','alice',{sessionId,tool:'monitor',arguments:{}});
    assert.equal(replies.at(-1).body.result.ok,true);
    enabled=false;
    await invoke('invoke_connection','alice',{sessionId,tool:'monitor',arguments:{}});
    assert.equal(replies.at(-1).body.result.ok,false);
    assert.deepEqual(operations,['connect','invoke_connection']);
  } finally {
    bridge.stop();
  }
});
