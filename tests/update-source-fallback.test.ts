import test from 'node:test';
import assert from 'node:assert/strict';
import { requestUpdateWithFallback as fetchUpdate } from '../src/shared/update-source-fallback';
const base='https://shell.canp.ai/downloads/';
const gh='https://github.com/Yeqi99/CShell/releases/download/';
const release=(tag:string,name:string)=>({tag_name:tag,assets:[{name,size:42,digest:'sha256:'+'a'.repeat(64),browser_download_url:gh+tag+'/'+name}]});
test('catalog 522 fallback retains strict edition, tag and official asset identity',async()=>{
 const catalog=[release('v0.8.17','CShell-0.8.17-win-x64.exe'),release('pro-v0.8.16','CShell-Pro-0.8.16-win-x64.exe'),{...release('pro-v0.8.18','evil.exe'),prerelease:true}];
 for(const edition of ['pro','opensource']){
 const r=await fetchUpdate(base+edition+'/releases.json',async u=>u.startsWith(base)?new Response(null,{status:522}):Response.json(catalog));
 const items=await r.json();assert.equal(items.length,1);assert.equal(items[0].tag_name,edition==='pro'?'v0.8.16':'v0.8.17');assert(items[0].assets[0].browser_download_url.startsWith(base+edition+'/'));assert.equal(items[0].assets[0].digest,'sha256:'+'a'.repeat(64));
 }
});
test('successful catalog leaves original bytes intact',async()=>{let calls=0;assert.equal(await(await fetchUpdate(base+'pro/releases.json',async()=>{calls++;return new Response('[]')})).text(),'[]');assert.equal(calls,1);});
test('attachment 522 uses exact same tag/file and constrained official CDN',async()=>{
 const seen:string[]=[];const name='CAgent-Setup-0.8.16-win-x64.exe';
 const r=await fetchUpdate(base+'pro/v0.8.16/'+name,async u=>{seen.push(u);return seen.length===1?new Response(null,{status:522}):seen.length===2?new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/verified?sig=abc'}}):new Response('verified-by-caller');});
 assert.equal(seen[1],gh+'pro-v0.8.16/'+name);assert.equal(await r.text(),'verified-by-caller');
});
test('404 never changes source or version; cancellation never retries',async()=>{
 let calls=0;const r=await fetchUpdate(base+'pro/v0.8.16/SHA256SUMS.txt',async()=>{calls++;return new Response(null,{status:404})});assert.equal(r.status,404);assert.equal(calls,1);
 await assert.rejects(fetchUpdate(base+'pro/releases.json',async()=>{throw new DOMException('cancel','AbortError')}),/cancel/);
});
test('timeout falls back, foreign redirects and untrusted input fail closed',async()=>{
 let calls=0;const r=await fetchUpdate(base+'pro/releases.json',async()=>{if(++calls===1)throw new DOMException('timeout','TimeoutError');return Response.json([])});assert.deepEqual(await r.json(),[]);
 await assert.rejects(fetchUpdate(base+'pro/v0.8.16/SHA256SUMS.txt',async u=>u.startsWith(base)?new Response(null,{status:522}):new Response(null,{status:302,headers:{location:'https://evil.example/payload'}})),/Untrusted/);
 await assert.rejects(fetchUpdate(base+'pro/v0.8.16/x.exe?redirect=evil',async()=>{throw Error('must not request')}),/Invalid update source/);
});
