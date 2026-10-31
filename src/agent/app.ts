import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { callAgent } from './control';
import { agentDirectory } from './storage';
import { page, script } from './app-page';

const methods=new Set(['managedWechat.status','managedWechat.configure','managedWechat.processes','managedWechat.bind','managedWechat.validate','automation.list','automation.create','automation.change','wsl.check','wsl.plan','wsl.install','wsl.status','wsl.cancel','wsl.account.status','wsl.account.initialize','wechat.status','wechat.configure','wechat.stop','update.check','update.download','update.status','update.install','update.settings','connection.autostart','connection.settings','connection.save','agent.shutdown','assistant.settings','assistant.configure','assistant.start','assistant.tasks','assistant.task','assistant.cancel','assistant.approve','client.status','agent.shells','agent.logs','client.access','client.start','client.stop','client.info','applications.policy','applications.configure','applications.list','applications.plan','applications.install','applications.status','applications.cancel','packages.catalog','packages.list','packages.tools','packages.invoke','packages.install','packages.grant','packages.uninstall','packages.refresh','desktop.recovery.plan','desktop.recovery.execute','desktop.status','desktop.configure','desktop.virtual-display.plan','desktop.virtual-display.status','desktop.virtual-display.install','desktop.virtual-display.remove','desktop.virtual-display.recover']);
export async function startCagentApp(directory=agentDirectory(),call=(method:string,params:unknown,signal:AbortSignal)=>callAgent(method,params,directory,signal)){
  const token=randomBytes(32).toString('hex');let origin='';let active=0;
  const scriptHash=createHash('sha256').update(script).digest('base64');
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
    if(req.headers.host!==new URL(origin).host){res.writeHead(403);res.end();return;}
    if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page);return;}
    const supplied=typeof req.headers['x-cagent-token']==='string'?req.headers['x-cagent-token']:'';
    if(req.method!=='POST'||req.url!=='/api'||req.headers.origin!==origin||!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token))){res.writeHead(403);res.end();return;}
    if(active>=6){res.writeHead(429);res.end();return;}active++;
    const abort=new AbortController();const timer=setTimeout(()=>abort.abort(new Error('本机请求超时')),65000);
    req.on('aborted',()=>abort.abort());res.on('close',()=>{if(!res.writableEnded)abort.abort();});
    try{
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>65536)throw new Error('请求过大');}
      const input=z.object({method:z.string(),params:z.unknown().optional()}).strict().parse(JSON.parse(body));
      if(!methods.has(input.method))throw new Error('此操作未开放给本机页面');
      const result=await call(input.method,input.params,abort.signal);
      if(!res.destroyed){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result}));}
    }catch(error){if(!res.destroyed){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error instanceof Error?error.message:'操作失败'}));}}
    finally{clearTimeout(timer);active--;}
  });
  server.maxConnections=12;server.headersTimeout=5000;server.requestTimeout=15000;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
  const address=server.address();if(!address||typeof address==='string')throw new Error('本机界面启动失败');
  origin='http://127.0.0.1:'+address.port;
  let closed=false;
  return {url:origin+'/#'+token,async close(){if(closed)return;closed=true;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
export async function openCagentApp(url:string){
  // URL is generated locally; never invoke a shell with user input.
  const child=process.platform==='win32'
    ?spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'})
    :spawn(process.platform==='darwin'?'open':'xdg-open',[url],{stdio:'ignore'});
  await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
}
