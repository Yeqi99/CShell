import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classroomLabAction,classroomLabSavedDraft,defaultClassroomLabDraft} from '../src/shared/classroom-lab';
test('lab template wraps actual script with literal parameters and defaults to preview',()=>{
 const source=readFileSync('scripts/classroom/Install-AI-Lab.ps1','utf8');
 const action=classroomLabAction(source,{...defaultClassroomLabDraft,root:"D:\\O'Brien\\$(whoami)",proxy:'http://192.168.1.2:7890'});
 assert.equal(action.shell,'powershell');assert(action.script.includes(source));assert(action.script.endsWith("-Root 'D:\\O''Brien\\$(whoami)' -Proxy 'http://192.168.1.2:7890'"));assert(!action.script.endsWith('-Apply'));assert(action.script.length<=16384);
 assert(classroomLabAction(source,{...defaultClassroomLabDraft,apply:true}).script.endsWith('-Apply'));
});
test('lab rejects secret proxy and malformed parameters; local draft drops secrets and Apply',()=>{
 assert.throws(()=>classroomLabAction('',{...defaultClassroomLabDraft,proxy:'http://user:pass@host'}));
 assert.throws(()=>classroomLabAction('',{...defaultClassroomLabDraft,root:'D:\nwhoami'}));
 assert.throws(()=>classroomLabAction('x'.repeat(16385),defaultClassroomLabDraft));
 assert.deepEqual(classroomLabSavedDraft({...defaultClassroomLabDraft,compute:'CUDA',proxy:'secret',apply:true,script:'secret'}),{...defaultClassroomLabDraft,compute:'CUDA'});
});
