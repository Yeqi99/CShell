import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { validatePlans, verifyRelease, boundedPayload, validateMarketPlan, publishStaged, verifyConcurrently } from './publish-verified-candidates.mjs';
test('payload verification never exceeds two workers and verifies every item', async () => {
  let active=0, peak=0;const checked=[];
  await verifyConcurrently([1,2,3,4,5],async item=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));checked.push(item);active--;});
  assert.equal(peak,2);assert.deepEqual(checked.sort(),[1,2,3,4,5]);
});
test('failed payload stops new work and waits for outstanding verification before rejecting', async () => {
  const started=[];let secondFinished=false;
  await assert.rejects(verifyConcurrently([1,2,3,4],async item=>{started.push(item);if(item===1)throw new Error('SHA mismatch');await new Promise(resolve=>setImmediate(resolve));secondFinished=true;}),/SHA mismatch/);
  assert.deepEqual(started,[1,2]);assert.equal(secondFinished,true);
});
const fixture = () => ['opensource','pro'].map(edition => ({ edition, status:'candidate-not-published', version:'0.8.20', sha:'a'.repeat(40), assets:[...Array.from({length:edition==='pro'?13:15},(_,i)=>({name:`CAgent-0.8.20-test-${i}.exe`,size:100,sha256:'b'.repeat(64)})),{name:'SHA256SUMS.txt',size:10,sha256:'c'.repeat(64)}] }));
test('complete distinct channels allowed without publication',()=>validatePlans(fixture()));
test('0.8.20 publisher refuses an older inventory by default',()=>{
  const plans=fixture();for(const plan of plans)plan.version='0.8.18';
  assert.throws(()=>validatePlans(plans));
});
test('market permits only exact six versioned binary assets, never source archives',async()=>{
  const plan=JSON.parse(await readFile(new URL('../services/update-edge/verified-wechat-012.json',import.meta.url),'utf8'));
  assert.throws(()=>validateMarketPlan({...plan,status:'blocked-pending-final-publication-source'}));plan.status='candidate-not-published';validateMarketPlan(plan);
  const bad=structuredClone(plan);bad.assets[0].name='Weixin-Toolkit-source.zip';assert.throws(()=>validateMarketPlan(bad));
});
test('oversize origin stream fails before writing excess bytes',async()=>{let written=0;await assert.rejects(pipeline(Readable.from([Buffer.alloc(4),Buffer.alloc(8)]),boundedPayload(5),new Writable({write(b,e,cb){written+=b.length;cb();}})),/exceeds verified size/);assert.equal(written,4);});
test('actual 30-asset release shape includes Core macOS ZIPs',async()=>{
  const plans=await Promise.all(['opensource','pro'].map(async e=>({...JSON.parse(await readFile(new URL(`../services/update-edge/verified-${e}-0818.json`,import.meta.url),'utf8')),status:'candidate-not-published'})));
  assert.equal(plans.flatMap(p=>p.assets).length,30);assert(plans[0].assets.some(a=>a.name.endsWith('.zip')));validatePlans(plans,'0.8.18');
});
test('interrupted pair accepts exact public channel read-only, refuses changed source or asset',()=>{
  const plan={...fixture()[0],tag:'v0.8.20'},release={tag_name:plan.tag,target_commitish:plan.sha,prerelease:false,draft:false};
  const assets=plan.assets.map(a=>({...a,digest:`sha256:${a.sha256}`}));verifyRelease(release,plan,assets);
  assert.throws(()=>verifyRelease({...release,target_commitish:'b'.repeat(40)},plan,assets));
  assert.throws(()=>verifyRelease(release,plan,assets.map((a,i)=>i? a:{...a,size:a.size+1})));
});
test('blocked candidate, wrong channel, duplicates and traversals fail closed',()=>{
  for(const mutate of [p=>p[0].status='blocked-native-window-android-rebuild-required',p=>p[0].sha='main',p=>p[0].assets.pop(),p=>p[0].assets[0].name='../private.zip',p=>p[0].assets[0].name=p[0].assets[1].name,p=>p[0].assets[0].name='CShell-Pro-0.8.20-win-x64.exe']){const p=fixture();mutate(p);assert.throws(()=>validatePlans(p));}
});

const stagedFixture = () => {
  const plans = fixture().map(p => ({...p, tag: (p.edition === 'pro' ? 'pro-' : '')+'v0.8.20'}));
  const releases = plans.map((p,i) => ({id:i+1,tag_name:p.tag,target_commitish:p.sha,prerelease:false,draft:true}));
  const assets = plans.map(p => p.assets.map(a => ({...a,digest:'sha256:'+a.sha256})));
  const writes = [];
  const api = async (path,method='GET',body) => {
    if(method !== 'GET') { assert.equal(method,'PATCH'); assert.deepEqual(body,{draft:false});writes.push(path);return {...releases[Number(path.split('/')[1])-1],draft:false}; }
    if(path.startsWith('commits/'))return {sha:path.split('/')[1]};
    if(path.startsWith('git/ref/'))return null;
    const id=Number(path.split('/')[1])-1;
    assert(id===0 || id===1, 'No download/upload/create endpoint permitted');
    return path.includes('/assets?') ? assets[id] : releases[id];
  };
  return {plans,releases,assets,writes,api};
};
test('publish-only checks both staged channels and only PATCHes publication',async()=>{
 const f=stagedFixture();await publishStaged(f.plans,f.api,f.releases);assert.deepEqual(f.writes,['releases/1','releases/2']);
});
test('publish-only rejects incomplete or changed second draft before any publication',async()=>{
 for(const mutate of [f=>f.assets[1].pop(),f=>f.assets[1][0].digest='sha256:'+'0'.repeat(64),f=>f.assets[1][0].size++,f=>f.releases[1].target_commitish='0'.repeat(40),f=>f.releases.pop(),f=>f.releases.push({...f.releases[1]})]){
  const f=stagedFixture();mutate(f);await assert.rejects(publishStaged(f.plans,f.api,f.releases));assert.deepEqual(f.writes,[]);
 }
});
test('publish-only recovery preserves exact public channel',async()=>{
 const f=stagedFixture();f.releases[0].draft=false;await publishStaged(f.plans,f.api,f.releases);assert.deepEqual(f.writes,['releases/2']);
});
