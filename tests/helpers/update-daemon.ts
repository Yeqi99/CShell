export function updateDaemonSource(version:string,mode='normal'){
 return `const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const data=process.env.CSHELL_AGENT_DATA,identity=fs.readFileSync(path.join(data,'identity'),'utf8');
let pending=!!process.env.CSHELL_AGENT_UPDATE_COMMIT;
const token='b'.repeat(64),version=${JSON.stringify(version)},mode=${JSON.stringify(mode)};
const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
 if(req.headers.authorization!=='Bearer '+token){res.writeHead(401);res.end('{}');return;}
 const {method,params}=JSON.parse(body),status={deviceId:mode==='wrong-identity'?'wrong':identity,agentVersion:version,updateProtocol:1,updatePendingCommit:pending};
 const reply=value=>res.end(JSON.stringify({result:value}));
 if(method==='client.status')return reply(status);
 if(method==='update.commit'){
  if(mode==='uncertain'){req.socket.destroy();return;}
  if(params.token!==process.env.CSHELL_AGENT_UPDATE_COMMIT){res.end(JSON.stringify({error:'wrong commit token'}));return;}
  pending=false;fs.writeFileSync(path.join(data,'accepted'),version);
  if(mode==='lost-response'){req.socket.destroy();return;}
  return reply({committed:true,deviceId:identity,agentVersion:version});
 }
 if(method==='agent.shutdown'){reply({closed:true});setTimeout(()=>server.close(()=>process.exit(0)),10);return;}
 res.end(JSON.stringify({error:'unsupported'}));
 });});server.listen(0,'127.0.0.1',()=>fs.writeFileSync(path.join(data,'discovery.json'),JSON.stringify({version:1,port:server.address().port,token,pid:process.pid})));`;
}
