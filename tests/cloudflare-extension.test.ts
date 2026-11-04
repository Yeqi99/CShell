import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CloudflareExtension,validOAuthState} from '../src/extensions/cloudflare/service';

test('OAuth state is mandatory and exact',()=>{
  assert.equal(validOAuthState(null,'secret'),false);
  assert.equal(validOAuthState('',''),false);
  assert.equal(validOAuthState('other','secret'),false);
  assert.equal(validOAuthState('secret','secret'),true);
});
test('official MCP OAuth flow, encrypted persistence, tools, disable and disconnect',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'cshell-cf-'));
  let opened='',enabled=true,grants=0,writes=0;
  const network:typeof fetch=async(input,init)=>{
    const url=String(input);
    const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
    if(url.includes('.well-known/oauth-protected-resource'))return json({resource:'https://mcp.cloudflare.com/mcp',authorization_servers:['https://mcp.cloudflare.com']});
    if(url.includes('.well-known/'))return json({issuer:'https://mcp.cloudflare.com',authorization_endpoint:'https://mcp.cloudflare.com/authorize',token_endpoint:'https://mcp.cloudflare.com/token',registration_endpoint:'https://mcp.cloudflare.com/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256']});
    if(url.endsWith('/register'))return json({...JSON.parse(String(init?.body)),client_id:'fixture-client'});
    if(url.endsWith('/token'))return json({access_token:'fixture-secret',token_type:'Bearer',refresh_token:'fixture-refresh',expires_in:3600});
    const headers=new Headers(init?.headers);
    if(headers.get('authorization')!=='Bearer fixture-secret')return new Response('',{status:401,headers:{'WWW-Authenticate':'Bearer resource_metadata="https://mcp.cloudflare.com/.well-known/oauth-protected-resource"'}});
    if(init?.method==='GET')return new Response('',{status:405});
    const message=JSON.parse(String(init?.body));
    if(message.id===undefined)return new Response(null,{status:202});
    let result:unknown;
    if(message.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
    else if(message.method==='tools/list')result={tools:['search','execute','docs'].map(name=>({name,description:name,inputSchema:{type:'object',properties:{code:{type:'string'}}}}))};
    else {writes++;result={content:[{type:'text',text:'verified'}]};}
    return json({jsonrpc:'2.0',id:message.id,result});
  };
  const service=new CloudflareExtension({directory,enabled:()=>enabled,encrypt:async s=>Buffer.from(s).toString('base64'),decrypt:async s=>Buffer.from(s,'base64').toString(),open:async s=>{opened=s;},authorized:async()=>{grants++;}},network);
  try{
    await service.load();assert.equal(service.tools().length,0);
    await service.authorize();assert.ok(opened);
    const stale=new URL(opened);
    await service.call('restart');
    const auth=new URL(opened),callback=auth.searchParams.get('redirect_uri')!;
    assert.notEqual(auth.searchParams.get('state'),stale.searchParams.get('state'));
    assert.notEqual(auth.searchParams.get('code_challenge'),stale.searchParams.get('code_challenge'));
    assert.equal((await fetch(callback+'?state='+stale.searchParams.get('state')+'&code=fixture')).status,400);
    assert.equal((await fetch(callback+'?state=wrong&code=fixture')).status,400);
    assert.equal(service.status().pending,true);
    assert.equal((await fetch(callback+'?state='+auth.searchParams.get('state')+'&code=fixture')).status,200);
    for(let n=0;n<100&&grants===0;n++)await new Promise(r=>setTimeout(r,20));
    assert.equal(grants,1);assert.equal(service.status().connected,true);
    assert.equal((await readFile(join(directory,'oauth.enc'),'utf8')).includes('fixture-secret'),false);
    const tool=service.tools()[0];assert.equal(tool.needsReview({tool:'execute'}),true);
    assert.equal(tool.needsReview({tool:'search'}),false);
    assert.match(await tool.invoke({tool:'execute',arguments:{code:'return 1'}},new AbortController().signal),/verified/);
    assert.equal(writes,1);
    enabled=false;assert.equal(service.tools().length,0);
    await assert.rejects(tool.invoke({tool:'execute',arguments:{}},new AbortController().signal));assert.equal(writes,1);
    await service.disconnect();assert.equal(service.status().authorized,false);
  }finally{await service.disconnect();await rm(directory,{recursive:true,force:true});}
});
