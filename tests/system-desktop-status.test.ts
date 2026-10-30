import {test} from 'node:test';
import assert from 'node:assert/strict';
import {systemDesktopReady} from '../src/agent/system-desktop';
const state={installed:true,running:true,elevated:true,runtimeImagePath:'C:/CAgent/node.exe',proxyPath:'C:/service/worker.exe',proxyPresent:true,packageMatches:true,updateRequired:false};
test('system desktop requires current bundled worker and broker',()=>{
 assert.equal(systemDesktopReady(state,state.runtimeImagePath).ready,true);
 assert.equal(systemDesktopReady({...state,packageMatches:false,updateRequired:true},state.runtimeImagePath).ready,false);
 const {packageMatches,updateRequired,...legacy}=state;
 assert.equal(systemDesktopReady(legacy,state.runtimeImagePath).ready,false);
 for(const field of ['running','elevated','proxyPresent'])assert.equal(systemDesktopReady({...state,[field]:false},state.runtimeImagePath).ready,false);
 assert.equal(systemDesktopReady(state,'C:/other/node.exe').ready,false);
});
