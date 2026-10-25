import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {McpService} from '../src/core/mcp';
import {Store} from '../src/core/store';
import {FtpService} from '../src/core/ftp';
import {FtpConnectionProvider,ftpIdentity} from '../src/core/connections/ftp-provider';
import {ConnectionManager} from '../src/core/connections/manager';
import {ConnectionRegistry} from '../src/core/connections/registry';
import {visualToolSource} from '../src/core/visual-tools';
import {visualCapabilities} from '../src/shared/visual-tools';
import {ftpFixture} from './helpers/ftp-server';

test('real MCP/REST FTP discovery respects grants, file-only providers, saved identity and client ownership',{timeout:30000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'mcp-ftp-')),server=await ftpFixture();
 const store=new Store(directory,{encrypt:async v=>Buffer.from(v).toString('base64'),decrypt:async v=>Buffer.from(v,'base64').toString()});await store.load();
 const profile={id:randomUUID(),name:'FTP protocol fixture',protocol:'ftp' as const,host:'127.0.0.1',port:server.port,username:'fixture',group:'',favorite:false,auth:'password' as const};
 await store.saveProfile(profile);await store.setSecret(profile.id,{password:'fixture-private-password'});
 const registry=new ConnectionRegistry(target=>{const current=store.snapshot().profiles.find(p=>p.id===target.resourceId);return current?.protocol==='ftp'&&ftpIdentity(current as typeof profile)===target.identity?{id:current.id,group:current.group}:undefined;}),manager=new ConnectionManager(registry);
 let service:McpService|undefined,visualCalls=0;
 const ftp=new FtpService(event=>{if(event.type==='closed')manager.closed(event.sessionId);service?.event(event);});manager.register(new FtpConnectionProvider(ftp));
 registry.registerToolSource('cshell.visual',visualCapabilities,visualToolSource({browser:async()=>{visualCalls++;throw Error('FTP must not open a browser');},desktop:async()=>{visualCalls++;throw Error('FTP must not open a desktop');}}));
 const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as {port:number}).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
 service=new McpService(store,directory,async()=>true,{manager,connect:async(p,signal,ready)=>manager.connect('cshell.ftp',p,(await store.secret(p.id))!,signal,ready)});
 const deniedId=randomUUID(),readId=randomUUID(),writeId=randomUUID();
 const settings={enabled:true,port,allowedProfiles:[],allowCommands:false,capabilities:[],clients:[
  {id:deniedId,name:'No files',capabilities:[]},
  {id:readId,name:'Read files',capabilities:['files.read']},
  {id:writeId,name:'Create files',capabilities:['files.read','files.create']},
 ].map(client=>({...client,capabilities:client.capabilities as ('files.read'|'files.create')[],enabled:true,allowedProfiles:[profile.id],allowCommands:false,review:'authorized' as const,disclosure:{mode:(client.id===writeId?'progressive':'full') as 'progressive'|'full',level:'names' as const,budgetBytes:8192}}))};
 const clients:Client[]=[];
 try{
  await service.configure(settings);
  const token=await service.accessToken(deniedId),readToken=await service.accessToken(readId),writeToken=await service.accessToken(writeId);
  const api=async(path:string,body:unknown,bearer=token)=>{const response=await fetch(`http://127.0.0.1:${port}/api/v1/${path}`,{method:'POST',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json',Connection:'close'},body:JSON.stringify(body)});return{status:response.status,body:await response.json() as any};};
  const invoke=(name:string,args:unknown,bearer=token)=>api('invoke',{name,arguments:args},bearer);
  const openClient=async(bearer:string)=>{const client=new Client({name:'FTP test',version:'1'});clients.push(client);await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`),{requestInit:{headers:{Authorization:'Bearer '+bearer,Connection:'close'}}}));return client;};
  const deniedClient=await openClient(token);
  const deniedNames=(await deniedClient.listTools()).tools.map(t=>t.name);assert.ok(!deniedNames.includes('list_files'));assert.ok(!deniedNames.some(n=>n.startsWith('terminal_')||n==='execute_command'));
  const deniedSession=(await invoke('connect',{profileId:profile.id})).body.result.sessionId;
  assert.deepEqual((await invoke('describe_connection',{sessionId:deniedSession})).body.result.tools,[]);
  assert.deepEqual((await api('capabilities',{sessionId:deniedSession,level:'contract'})).body.result.items,[]);
  const before=server.commands.filter(c=>c.startsWith('MLSD')).length;
  assert.equal((await invoke('invoke_connection',{sessionId:deniedSession,tool:'list_files',arguments:{path:'/'}})).status,403);
  const denied=await deniedClient.callTool({name:'invoke_connection',arguments:{sessionId:deniedSession,tool:'ftp_create_text',arguments:{path:'/denied.txt',content:'forbidden',acceptNonAtomic:true}}});assert.equal(denied.isError,true);assert.equal(server.files.has('/denied.txt'),false);assert.equal(server.commands.filter(c=>c.startsWith('MLSD')).length,before);
  const readClient=await openClient(readToken);const readResult=await readClient.callTool({name:'connect',arguments:{profileId:profile.id}});assert.equal(readResult.isError,undefined,JSON.stringify(readResult));const readSession=JSON.parse((readResult.content as any)[0].text).sessionId;
  const contracts=(await invoke('describe_connection',{sessionId:readSession},readToken)).body.result;assert.equal(contracts.target.providerId,'cshell.ftp');assert.deepEqual(contracts.tools.map((t:any)=>t.name).sort(),['ftp_read_text','list_files']);
  const discovered=(await api('capabilities',{sessionId:readSession,level:'contract'},readToken)).body.result.items;assert.equal(discovered.length,2);assert.ok(!JSON.stringify(discovered).includes('browser_'));assert.ok(!JSON.stringify(discovered).includes('terminal_'));assert.equal(visualCalls,0);
  const listed=await readClient.callTool({name:'list_files',arguments:{sessionId:readSession,path:'/'}});assert.equal(listed.isError,undefined);assert.ok(JSON.stringify(listed).includes('hello.txt'));
  const text=(await invoke('invoke_connection',{sessionId:readSession,tool:'ftp_read_text',arguments:{path:'/hello.txt'}},readToken)).body.result;assert.equal(JSON.parse(text).content,'hello 中文\n');
  assert.equal((await invoke('describe_connection',{sessionId:readSession})).status,404,'another API client cannot use this connection');
  assert.equal((await invoke('invoke_connection',{sessionId:readSession,tool:'ftp_create_text',arguments:{path:'/read-only.txt',content:'forbidden',acceptNonAtomic:true}},readToken)).status,403);assert.equal(server.files.has('/read-only.txt'),false);
  const writeSession=(await invoke('connect',{profileId:profile.id},writeToken)).body.result.sessionId;
  const written=await invoke('invoke_connection',{sessionId:writeSession,tool:'ftp_create_text',arguments:{path:'/mcp.txt',content:'real protocol',acceptNonAtomic:true}},writeToken);assert.equal(written.status,200,JSON.stringify(written.body));assert.equal(server.files.get('/mcp.txt')?.toString(),'real protocol');
  const writer=await openClient(writeToken);assert.deepEqual((await writer.listTools()).tools.map(t=>t.name).sort(),['discover_capabilities','invoke_capability']);
  const progressive=await writer.callTool({name:'invoke_capability',arguments:{name:'invoke_connection',arguments:{sessionId:writeSession,tool:'ftp_create_text',arguments:{path:'/progressive.txt',content:'progressive MCP',acceptNonAtomic:true}}}});assert.equal(progressive.isError,undefined,JSON.stringify(progressive));assert.equal(server.files.get('/progressive.txt')?.toString(),'progressive MCP');
  assert.ok(!JSON.stringify((await invoke('list_servers',{},writeToken)).body).includes('fixture-private-password'));
  await store.saveProfile({...profile,username:'changed-user'});
  assert.notEqual((await invoke('invoke_connection',{sessionId:writeSession,tool:'ftp_create_text',arguments:{path:'/stale.txt',content:'forbidden',acceptNonAtomic:true}},writeToken)).status,200);assert.equal(server.files.has('/stale.txt'),false);
 }finally{for(const client of clients)await client.close().catch(()=>{});await service.configure({...settings,enabled:false});ftp.dispose();await server.close();await rm(directory,{recursive:true,force:true});}
});
