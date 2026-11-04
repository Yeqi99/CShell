import {test} from 'node:test';
import assert from 'node:assert/strict';
import {systemDesktopReady,needsSystemDesktopRefresh} from '../src/agent/system-desktop';
const state={installed:true,running:true,elevated:true,runtimeImagePath:'C:/CAgent/node.exe',proxyPath:'C:/service/worker.exe',proxyPresent:true,packageMatches:true,updateRequired:false};
test('system desktop requires current bundled worker and broker',()=>{
 assert.equal(systemDesktopReady(state,state.runtimeImagePath).ready,true);
 assert.equal(systemDesktopReady({...state,packageMatches:false,updateRequired:true},state.runtimeImagePath).ready,false);
 const {packageMatches,updateRequired,...legacy}=state;
 assert.equal(systemDesktopReady(legacy,state.runtimeImagePath).ready,false);
 for(const field of ['running','elevated','proxyPresent'])assert.equal(systemDesktopReady({...state,[field]:false},state.runtimeImagePath).ready,false);
 assert.equal(systemDesktopReady(state,'C:/other/node.exe').ready,false);
});
test('existing elevated desktop service is refreshed for version-slot or bundled-byte changes only',()=>{
 const ready=systemDesktopReady(state,state.runtimeImagePath);
 assert.equal(needsSystemDesktopRefresh(ready),false);
 assert.equal(needsSystemDesktopRefresh(systemDesktopReady(state,'C:/CAgent/versions/new/node.exe')),true);
 assert.equal(needsSystemDesktopRefresh({...ready,packageMatches:false}),true);
 assert.equal(needsSystemDesktopRefresh({...ready,packageMatches:false,elevated:false}),false);
 assert.equal(needsSystemDesktopRefresh({...ready,packageMatches:false,installed:false}),false);
 assert.equal(needsSystemDesktopRefresh({ready:false}),false);
});
