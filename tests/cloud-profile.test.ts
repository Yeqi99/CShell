import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudSync } from '../src/core/cloud-sync';
test('account identity returns immediately and cached membership survives restart and offline refresh', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cshell-profile-'));let offline=false;
 const request:typeof fetch=async(url)=>{if(offline)throw new TypeError('fetch failed');return String(url).endsWith('/account')?Response.json({membership:{active:false,expiresAt:null}}):Response.json({accountId:'a'.repeat(32),email:'test@example.com',token:'t'.repeat(43)});};
 const make=()=>new CloudSync(dir,{encrypt:async s=>s,decrypt:async s=>s},{export:async()=>({}),validate:()=>{},import:async()=>{}},'https://test.invalid',request);
 try{const cloud=make();await cloud.login('test@example.com','123456');const first=await cloud.accountStatus();assert.equal(first.email,'test@example.com');for(let i=0;i<50&&!cloud.status().membership;i++)await new Promise(r=>setTimeout(r,5));assert.equal(cloud.status().membership?.active,false);for(let i=0;i<50;i++){try{if(JSON.parse(await readFile(join(dir,'cloud-sync.enc'),'utf8')).membership)break;}catch{}await new Promise(r=>setTimeout(r,100));}offline=true;const restarted=make();await restarted.load();assert.equal(restarted.status().membership?.active,false);await restarted.accountStatus();await new Promise(r=>setTimeout(r,25));assert.equal(restarted.status().membership?.active,false);assert.equal(restarted.status().email,'test@example.com');}finally{await rm(dir,{recursive:true,force:true});}
});
