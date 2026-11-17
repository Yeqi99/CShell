import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {hasAccountSource} from '../src/core/account-source-discovery';

test('discovery reads only presence for populated profiles and probes encrypted-only sources',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cshell-discovery-'));
 try{
  const unexpected=async()=>{throw Error('unexpected credential export');};
  assert.equal(await hasAccountSource(root,unexpected),false);
  await writeFile(join(root,'config.json'),JSON.stringify({version:1,profiles:[{name:'test'}]}));
  assert.equal(await hasAccountSource(root,unexpected),true);
  await writeFile(join(root,'config.json'),JSON.stringify({version:1,profiles:[]}));
  assert.equal(await hasAccountSource(root,async()=>false),false);
  assert.equal(await hasAccountSource(root,async()=>true),true);
 }finally{await rm(root,{recursive:true,force:true});}
});
