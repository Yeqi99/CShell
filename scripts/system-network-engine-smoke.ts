// Runs the real engine with loopback-only inbound; never creates TUN/routes/firewall.
import {createServer,connect,type Socket} from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
import {systemExitConfig} from '../src/core/system-network-exit';
import {localHttpProxy} from '../src/core/local-http-proxy';
const listen=async(server:ReturnType<typeof createServer>)=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return (server.address() as {port:number}).port;};
const echo=createServer(s=>s.pipe(s));const port=await listen(echo);const requests:string[]=[];
const proxy=await localHttpProxy(async(host,p,signal)=>{requests.push(host+':'+p);return await new Promise<Socket>((ok,fail)=>{const s=connect({host,port:p,signal},()=>ok(s));s.once('error',fail);});});
const reserve=createServer();const inbound=await listen(reserve);await new Promise<void>(r=>reserve.close(()=>r()));
const directory=await mkdtemp(join(tmpdir(),'cshell-engine-check-'));const config=systemExitConfig({platform:'win32',proxyPort:proxy.port,controlAddresses:['192.0.2.1']}) as any;
config.inbounds=[{type:'http',tag:'system',listen:'127.0.0.1',listen_port:inbound}];
await writeFile(join(directory,'config.json'),JSON.stringify(config));
const child=spawn(process.argv[2],['run','-c',join(directory,'config.json')],{windowsHide:true,stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',b=>{errors=(errors+b).slice(-4000)});
const roundtrip=()=>new Promise<string>((ok,fail)=>{const s=connect(inbound,'127.0.0.1');let head='',ready=false,data='';const timer=setTimeout(()=>{s.destroy();fail(Error('timeout '+errors))},5000);s.once('error',e=>{clearTimeout(timer);fail(e)});s.on('data',b=>{if(!ready){head+=b;if(head.includes('\r\n\r\n')){if(!head.startsWith('HTTP/1.1 200')){clearTimeout(timer);s.destroy();fail(Error('CONNECT rejected'));return;}ready=true;s.write('route-check');}}else{data+=b;if(data==='route-check'){clearTimeout(timer);s.destroy();ok(data);}}});s.on('connect',()=>s.write(`CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`));s.on('close',()=>{clearTimeout(timer);if(data!=='route-check')fail(Error('closed'));});});
try{let ready=false;for(let i=0;i<40;i++){try{await roundtrip();ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert(ready,errors);assert(requests.includes('127.0.0.1:'+port));proxy.close();await assert.rejects(roundtrip());console.log('PASS real sing-box TCP via selected CONNECT proxy; missing exit rejects, no direct fallback; no system network mutation');}
finally{child.kill();await new Promise<void>(r=>child.once('exit',()=>r()));proxy.close();await new Promise<void>(r=>echo.close(()=>r()));await rm(directory,{recursive:true,force:true});}
