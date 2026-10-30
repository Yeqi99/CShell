import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NativeDesktop} from '../src/agent/desktop-native';
test('native input completion correlates generation and sequence; errors and close reject',async()=>{
 const native=new NativeDesktop('unused');const commands:any[]=[];(native as any).send=(value:any)=>commands.push(value);
 let done=false;const pending=native.inputConfirmed({kind:'move',x:.2,y:.4,generation:2,sequence:5}).then(()=>{done=true;});
 native.emit('input-status',{generation:1,sequence:5});native.emit('input-status',{generation:2,sequence:4});await Promise.resolve();assert.equal(done,false);
 native.emit('input-status',{generation:2,sequence:5});await pending;assert.equal(commands.length,1);
 const failure=native.inputConfirmed({kind:'move',x:.2,y:.4,generation:2,sequence:6});const fail=assert.rejects(failure,/denied/);native.emit('input-error',Error('denied'));await fail;
 const closed=native.inputConfirmed({kind:'move',x:.2,y:.4,generation:2,sequence:7});const close=assert.rejects(closed,/lost/);native.emit('closed');await close;
 assert.equal(native.listenerCount('input-status'),0);
});
