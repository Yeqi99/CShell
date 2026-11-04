import {test} from 'node:test';
import assert from 'node:assert/strict';
import {updateCliRequest} from '../src/agent/update-cli';
import {agentManageInput} from '../src/core/api/agent-inputs';
import {agentCallSchema,agentCapability} from '../src/shared/agent';
test('remote update contracts permit only bounded management operations',()=>{
 for(const action of ['check','download','status','install']){
  const request=updateCliRequest(action==='install'?[action,'--confirm']:[action]);
  assert(agentManageInput.safeParse(request).success);assert(agentCallSchema.safeParse(request).success);
  assert.equal(agentCapability(request.method),'agent.manage');
  assert(!agentManageInput.safeParse({...request,params:{...request.params,url:'https://evil/a.exe'}}).success);
 }
 for(const method of ['update.verify','update.commit','update.settings']) assert(!agentCallSchema.safeParse({method}).success);
 assert(!agentManageInput.safeParse({method:'update.install',params:{}}).success);
});
test('update CLI maps only bounded local updater actions and explicit installation confirmation',()=>{
 for(const action of ['check','download','status']) assert.deepEqual(updateCliRequest([action]),{method:'update.'+action,params:{}});
 assert.deepEqual(updateCliRequest(['install','--confirm']),{method:'update.install',params:{confirm:true}});
 for(const args of [[],['install'],['commit'],['install','--confirm','--force'],['download','https://example.com/a.exe'],['status','--confirm']]) assert.throws(()=>updateCliRequest(args));
});
