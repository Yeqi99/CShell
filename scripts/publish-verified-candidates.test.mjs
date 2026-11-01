import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validatePlans, verifyRelease } from './publish-verified-candidates.mjs';
const fixture = () => ['opensource','pro'].map(edition => ({ edition, status:'candidate-not-published', version:'0.8.18', sha:'a'.repeat(40), assets:[...Array.from({length:edition==='pro'?13:15},(_,i)=>({name:`CAgent-0.8.18-test-${i}.exe`,size:100,sha256:'b'.repeat(64)})),{name:'SHA256SUMS.txt',size:10,sha256:'c'.repeat(64)}] }));
test('complete distinct channels allowed without publication',()=>validatePlans(fixture()));
test('actual 30-asset release shape includes Core macOS ZIPs',async()=>{
  const plans=await Promise.all(['opensource','pro'].map(async e=>({...JSON.parse(await readFile(new URL(`../services/update-edge/verified-${e}-0818.json`,import.meta.url),'utf8')),status:'candidate-not-published'})));
  assert.equal(plans.flatMap(p=>p.assets).length,30);assert(plans[0].assets.some(a=>a.name.endsWith('.zip')));validatePlans(plans);
});
test('interrupted pair accepts exact public channel read-only, refuses changed source or asset',()=>{
  const plan={...fixture()[0],tag:'v0.8.18'},release={tag_name:plan.tag,target_commitish:plan.sha,prerelease:false,draft:false};
  const assets=plan.assets.map(a=>({...a,digest:`sha256:${a.sha256}`}));verifyRelease(release,plan,assets);
  assert.throws(()=>verifyRelease({...release,target_commitish:'b'.repeat(40)},plan,assets));
  assert.throws(()=>verifyRelease(release,plan,assets.map((a,i)=>i? a:{...a,size:a.size+1})));
});
test('blocked candidate, wrong channel, duplicates and traversals fail closed',()=>{
  for(const mutate of [p=>p[0].status='blocked-native-window-android-rebuild-required',p=>p[0].sha='main',p=>p[0].assets.pop(),p=>p[0].assets[0].name='../private.zip',p=>p[0].assets[0].name=p[0].assets[1].name,p=>p[0].assets[0].name='CShell-Pro-0.8.18-win-x64.exe']){const p=fixture();mutate(p);assert.throws(()=>validatePlans(p));}
});
