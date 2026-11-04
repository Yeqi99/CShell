import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {cloudMcpGateway} from '../services/cloud-mcp/gateway';

test('real SDK HTTP/SSE lifecycle, scope, token ownership, revoke and reconnect',async()=>{
 const token='csmcp_'+'a'.repeat(43),other='csmcp_'+'b'.repeat(43);let active=true,calls=0;
 const gateway=cloudMcpGateway({checkMs:20,authorize:async t=>{if(!active||![token,other].includes(t))throw Error('revoked');return {account:'a',client:t,bridgeId:'b',expiresAt:Date.now()/1000+60,scopes:['list_servers_page']};},invoke:async()=>{calls++;return {servers:[]};}});
 await new Promise<void>(r=>gateway.http.listen(0,'127.0.0.1',r));
 const url=new URL(`http://127.0.0.1:${(gateway.http.address() as {port:number}).port}/mcp`);
 const make=()=>new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:'Bearer '+token}}});
 const client=new Client({name:'integration',version:'1'});const transport=make();
 try{
  await client.connect(transport);assert.equal((await client.listTools()).tools[0].name,'list_servers_page');
  const result=await client.callTool({name:'list_servers_page',arguments:{}});assert.ok(result.content);assert.equal(calls,1);
  await assert.rejects(client.callTool({name:'disconnect',arguments:{}}));assert.equal(calls,1);
  const hijack=await fetch(url,{method:'GET',headers:{Authorization:'Bearer '+other,'mcp-session-id':transport.sessionId!,Accept:'text/event-stream'}});assert.equal(hijack.status,404);
  await transport.terminateSession();await client.close();
  const second=new Client({name:'reconnect',version:'1'});await second.connect(make());assert.equal(calls,1);
  active=false;await new Promise(r=>setTimeout(r,50));await assert.rejects(second.listTools());await second.close();
 }finally{await client.close();await gateway.close();}
});

test('parallel initialize is bounded and malformed traffic cannot allocate sessions',async()=>{
 const token='csmcp_'+'c'.repeat(43);
 const gateway=cloudMcpGateway({maxSessions:3,authorize:async()=>({client:'c',account:'a',bridgeId:'b',expiresAt:Date.now()/1000+60,scopes:[]}),invoke:async()=>({})});
 await new Promise<void>(r=>gateway.http.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${(gateway.http.address() as {port:number}).port}/mcp`;
 const headers={Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
 try{
  assert.equal((await fetch(url,{method:'POST',headers,body:'not json'})).status,400);
  const results=await Promise.all(Array.from({length:12},()=>fetch(url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'load',version:'1'}}})}).then(async r=>{await r.text();return r.status;})));
  assert.equal(results.filter(s=>s===200).length,3);assert.equal(results.filter(s=>s===429).length,9);
 }finally{await gateway.close();}
});
