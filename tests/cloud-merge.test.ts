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
test('a remote reorder survives an independent local field edit, in either direction',()=>{
 const base=[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}];
 const edited=structuredClone(base);edited[0].name='Renamed';
 const reordered=[base[2],base[0],base[1]];
 for(const [local,remote]of [[edited,reordered],[reordered,edited]]){
  const result=mergeCloud(base,local,remote);
  assert.deepEqual(result.map((p:any)=>p.id),['c','a','b']);
  assert.equal(result[1].name,'Renamed');
 }
 assert.equal(base[0].name,'A');
});
test('matching reorders compose but incompatible reorders require reconciliation',()=>{
 const base=[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}];
 const local=[{...base[2],name:'C renamed'},base[0],base[1]];
 const same=[base[2],{...base[0],name:'A renamed'},base[1]];
 assert.deepEqual(mergeCloud(base,local,same).map((p:any)=>p.name),['C renamed','A renamed','B']);
 assert.throws(()=>mergeCloud(base,local,[base[1],base[0],base[2]]),/顺序/);
});
test('reorders preserve independent additions, deletions and device identities',()=>{
 const base=[{deviceId:'a',secret:'a-key'},{deviceId:'b',secret:'b-key'},{deviceId:'c',secret:'c-key'}];
 const local=[base[0],{deviceId:'new',secret:'new-key'},base[2]];
 const remote=[base[2],{...base[0],name:'A renamed'},base[1]];
 const result=mergeCloud(base,local,remote);
 assert.deepEqual(result.map((p:any)=>p.deviceId),['new','c','a']);
 assert.equal(result.find((p:any)=>p.deviceId==='a').name,'A renamed');
 assert.equal(result.find((p:any)=>p.deviceId==='new').secret,'new-key');
 assert(!result.some((p:any)=>p.deviceId==='b'));
 assert.deepEqual(mergeCloud(base,[base[0],{deviceId:'x',secret:'x'},...base.slice(1)],[...base,{deviceId:'y',secret:'y'}]).map((p:any)=>p.deviceId),['a','x','b','c','y']);
});
test('conflicting placement of a concurrently added identity is not silently chosen',()=>{
 const base=[{id:'a'},{id:'b'}];
 assert.throws(()=>mergeCloud(base,[{id:'x'},...base],[...base,{id:'x'}]),/顺序/);
});
