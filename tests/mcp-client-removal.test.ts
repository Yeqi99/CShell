import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {Store} from '../src/core/store';
import {McpService} from '../src/core/mcp';
import {apiClientSchema} from '../src/shared/contracts';

test('saving API client deletion revokes its HTTP token without revoking another client, including restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cshell-client-removal-'));
 const codec={encrypt:async(v:string)=>v,decrypt:async(v:string)=>v};
 const store=new Store(dir,codec);await store.load();
 const service=new McpService(store,dir,async()=>false);
 const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));
 const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
 const client=(name:string)=>apiClientSchema.parse({id:randomUUID(),name,enabled:true,allowedProfiles:[],allowCommands:false,capabilities:[],review:'always',disclosure:{mode:'full',level:'names',budgetBytes:4096}});
 const a=client('removed'),b=client('retained');
 try{
  await service.configure({...store.mcpSettings(),enabled:true,port,clients:[a,b]});
  const at=await service.accessToken(a.id),bt=await service.accessToken(b.id);
  const request=async(token:string)=>fetch(service.status().endpoint+'/api/v1/capabilities',{method:'POST',headers:{Connection:'close',Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({level:'names',limit:1})});
  assert.equal((await request(at)).status,200);assert.equal((await request(bt)).status,200);
  await service.configure({...store.mcpSettings(),clients:[b]});
  assert.equal((await request(at)).status,401);assert.equal((await request(bt)).status,200);
  await assert.rejects(service.accessToken(a.id),/Unknown API client/);
  assert.equal(await store.mcpToken(a.id),undefined);
  await service.stop();
  const restored=new Store(dir,codec);await restored.load();
  assert.deepEqual(restored.mcpSettings().clients?.map(c=>c.id),[b.id]);
  assert.equal(await restored.mcpToken(b.id),bt);
  assert.equal(await restored.mcpToken(a.id),undefined);
  await service.configure(store.mcpSettings());
  assert.equal((await request(at)).status,401);assert.equal((await request(bt)).status,200);
 }finally{await service.stop();await rm(dir,{recursive:true,force:true});}
});

