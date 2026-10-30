import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {Store} from '../src/core/store';
import {McpService} from '../src/core/mcp';
import {localApiTransport} from '../src/core/command-client';
import {defaultMcpPort} from '../src/shared/mcp-endpoint';
test('edition defaults are separate; existing custom port and token survive load',async()=>{
 assert.equal(defaultMcpPort(false),3777);assert.equal(defaultMcpPort(true),3778);
 const dir=await mkdtemp(join(tmpdir(),'mcp-edition-store-'));const codec={encrypt:async(v:string)=>v,decrypt:async(v:string)=>v};
 try{const s=new Store(dir,codec);await s.load();await s.setMcpSettings({...s.mcpSettings(),port:39123});await s.setMcpToken('retained-token');const loaded=new Store(dir,codec);await loaded.load();assert.equal(loaded.mcpSettings().port,39123);assert.equal(await loaded.mcpToken(),'retained-token');}finally{await rm(dir,{recursive:true,force:true});}
});
test('occupied endpoint is not advertised; wrong-edition calls rejected before execution',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mcp-edition-live-'));const codec={encrypt:async(v:string)=>v,decrypt:async(v:string)=>v};const a=new Store(join(dir,'a'),codec),b=new Store(join(dir,'b'),codec);await a.load();await b.load();const first=new McpService(a,join(dir,'a'),async()=>false),second=new McpService(b,join(dir,'b'),async()=>false);
 const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
 try{await first.configure({...a.mcpSettings(),enabled:true,port});await second.configure({...b.mcpSettings(),enabled:true,port});assert.equal(first.status().running,true);assert.equal(second.status().running,false);assert.equal(second.status().endpoint,undefined);assert.match(second.status().error!,/occupied/);
 const endpoint=first.status().endpoint!;const token=await first.accessToken();const transport=localApiTransport(endpoint,token,'pro');await assert.rejects(transport('invoke',{name:'unknown',arguments:{}}),/edition mismatch/);
 const response=await fetch(endpoint+'/api/v1/invoke',{method:'POST',headers:{'X-CShell-Edition':'pro',Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,409);assert.equal(response.headers.get('x-cshell-edition'),'opensource');
 const metadata=await fetch(endpoint+'/api/v1/capabilities',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({level:'summary',limit:1})});const value:any=await metadata.json();assert.equal(value.result.service.edition,'opensource');assert.equal(value.result.service.scope.length,16);
 }finally{await first.stop();await second.stop();await rm(dir,{recursive:true,force:true});}
});
