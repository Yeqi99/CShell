import {test} from 'node:test';import assert from 'node:assert/strict';import {mergeCloud} from '../src/core/cloud-merge';
test('independent device registration and model edits merge without dropping credentials',()=>{
 const base={devices:[{deviceId:'a',secret:'a-secret'}],ai:{providers:[{id:'model',name:'M',key:'secret'}]}};
 const local=structuredClone(base);local.ai.providers[0].name='Renamed';
 const remote=structuredClone(base);remote.devices.push({deviceId:'b',secret:'b-secret'});
 const merged=mergeCloud(base,local,remote);assert.equal(merged.devices.length,2);assert.equal(merged.ai.providers[0].name,'Renamed');assert.equal(merged.ai.providers[0].key,'secret');
});
test('conflicting edits and delete-versus-edit require reconciliation',()=>{
 assert.throws(()=>mergeCloud({key:'old'},{key:'one'},{key:'two'}));
 assert.throws(()=>mergeCloud([{id:'a',v:1}],[],[{id:'a',v:2}]));
 assert.deepEqual(mergeCloud([{id:'a',v:1}],[],[{id:'a',v:1}]),[]);
});
