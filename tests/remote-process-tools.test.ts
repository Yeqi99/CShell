import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteProcessTools } from '../src/core/remote-process-tools';
const definition={process:true,packageId:'example.echo',toolId:'echo',packageDigest:'a'.repeat(64),description:'Echo',permissions:['extension.execute'],sideEffect:false,inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},outputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}};
const signal=()=>new AbortController().signal;
test('remote custom process uses concrete schemas, machine execution policy and fixed high review',async()=>{
  const calls:string[]=[];const tools=await remoteProcessTools(async(call)=>{calls.push(call.method);return call.method==='packages.tools'?[definition]:{text:'remote'};},signal());
  assert.equal(tools.length,1);assert.equal(tools[0].capability,'commands.execute');assert.equal(tools[0].needsReview({}),true);
  assert.throws(()=>tools[0].input.parse({extra:'x'}));assert.equal(JSON.parse(await tools[0].invoke({text:'hello'},signal())).text,'remote');assert.deepEqual(calls,['packages.tools','packages.tools','packages.invoke']);
});
test('remote package replacement, revocation, invalid result and undeclared packages cannot bypass backend guards',async()=>{
  let catalog:unknown[]=[definition],result:unknown={wrong:true};let invokes=0;
  const call=async(input:any)=>{if(input.method==='packages.tools')return catalog;invokes++;return result;};
  const tools=await remoteProcessTools(call,signal());await assert.rejects(tools[0].invoke({text:'a'},signal()));assert.equal(invokes,1);
  catalog=[{...definition,packageDigest:'b'.repeat(64)}];await assert.rejects(tools[0].invoke({text:'a'},signal()),/changed/);assert.equal(invokes,1);
  catalog=[];await assert.rejects(tools[0].invoke({text:'a'},signal()),/revoked/);
  catalog=[{...definition,process:undefined},{...definition,packageId:'cshell.fake'},{...definition,permissions:[]}];assert.equal((await remoteProcessTools(call,signal())).length,0);
  catalog=[definition,definition];await assert.rejects(remoteProcessTools(call,signal()),/Duplicate/);
});
