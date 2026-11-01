import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlans } from './publish-verified-candidates.mjs';
const fixture = () => ['opensource','pro'].map(edition => ({ edition, status:'candidate-not-published', version:'0.8.18', sha:'a'.repeat(40), assets:[...Array.from({length:edition==='pro'?13:15},(_,i)=>({name:`CAgent-0.8.18-test-${i}.exe`,size:100,sha256:'b'.repeat(64)})),{name:'SHA256SUMS.txt',size:10,sha256:'c'.repeat(64)}] }));
test('complete distinct channels allowed without publication',()=>validatePlans(fixture()));
test('blocked candidate, wrong channel, duplicates and traversals fail closed',()=>{
  for(const mutate of [p=>p[0].status='blocked-native-window-android-rebuild-required',p=>p[0].sha='main',p=>p[0].assets.pop(),p=>p[0].assets[0].name='../private.zip',p=>p[0].assets[0].name=p[0].assets[1].name,p=>p[0].assets[0].name='CShell-Pro-0.8.18-win-x64.exe']){const p=fixture();mutate(p);assert.throws(()=>validatePlans(p));}
});
