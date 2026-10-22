import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {ideLaunch} from '../src/agent/ide-launch';
test('IDE launch authenticates, hands off cookies once and rejects revoked access', async()=>{
 const server=createServer((req,res)=>{assert.equal(req.url,'/login');assert.equal(req.method,'POST');let body='';req.on('data',v=>body+=v);req.on('end',()=>{assert.equal(body,'password=secret');res.writeHead(302,{'Set-Cookie':'code-server-session=verified; Path=/; HttpOnly; SameSite=Lax',Location:'/'}).end();});});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${(server.address() as any).port}/?folder=%2Fhome`;
 try {
  let allowed=true;
  const link=await ideLaunch(url,'secret',()=>allowed);
  assert.notEqual(new URL(link).port,new URL(url).port);
  const denied=await fetch(new URL('/wrong',link));assert.equal(denied.status,403);
  const handoff=await fetch(link,{redirect:'manual'});assert.equal(handoff.status,302);assert.equal(handoff.headers.get('location'),url);assert.match(handoff.headers.get('set-cookie')!,/HttpOnly/);
  await assert.rejects(fetch(link));
  const revoked=await ideLaunch(url,'secret',()=>allowed);allowed=false;
  assert.equal((await fetch(revoked)).status,403);
  await assert.rejects(ideLaunch('https://example.com','secret',()=>true),/地址/);
 }finally{server.close();}
});
