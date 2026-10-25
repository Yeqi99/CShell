import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {fixture} from './fixture';
import {SshService} from '../src/core/ssh';
import {Store} from '../src/core/store';
import {profileSchema} from '../src/shared/contracts';
import {createSshManager} from '../src/core/connections/ssh-provider';
import {createExtensionServices} from '../src/core/api/extensions';
import {ResourceInspection} from '../src/core/resource-inspection';
import {LinuxWorkspaceService} from '../src/core/linux-workspace';

test('actual desktop extension IPC and low-level clients cannot execute or forward through file-only SFTP',{timeout:20000},async()=>{
 await mkdir('.local',{recursive:true});const directory=await mkdtemp(join(process.cwd(),'.local','sftp-boundary-'));
 const remote=await fixture({stallShell:true}),ssh=new SshService(()=>{},async()=>true);
 try{
  const store=new Store(directory,{encrypt:async v=>v,decrypt:async v=>v});await store.load();
  const profile=profileSchema.parse({id:randomUUID(),name:'File only',protocol:'sftp',host:'127.0.0.1',port:remote.port,username:'tester',group:'',favorite:false,auth:'password'});await store.saveProfile(profile);
  const services=createExtensionServices(ssh,store);await services.plugins.install('cshell.python');await services.plugins.install('cshell.conda');await services.plugins.install('cshell.docker');
  const manager=createSshManager(ssh,()=>[profile],services.tools),id=await manager.connect('cshell.sftp',profile,{password:remote.password});
  const output=join(directory,'handlers.cjs');
  await build({entryPoints:['src/desktop/extensions.ts'],outfile:output,bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'electron-fixture',setup(b){b.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"export const dialog={showMessageBox:async()=>{throw Error('Unexpected approval dialog')}}; export const shell={openExternal:async()=>{throw Error('Unexpected browser')}};"}));}}]});
  const {registerExtensionHandlers}=createRequire(import.meta.url)(output),handlers=new Map<string,(...args:any[])=>any>();
  registerExtensionHandlers((name:string,fn:(...args:any[])=>any)=>handlers.set(name,fn),{},store,ssh,manager,undefined,services);
  const invoke=(name:string,...args:unknown[])=>Promise.resolve().then(()=>handlers.get(name)!(...args));
  assert.match((await invoke('text:read',id,'/hello.txt')).code,/CShell/);
  for(const [name,args] of [
   ['environments:list',[id]],['environments:packages',[id,'/usr/bin/python3']],
   ['text:environments',[id,'/hello.txt']],['python:analyze',[id,'/usr/bin/python3','print(1)',1,1]],
   ['applications:plan',[id,{app:'nginx'}]],['environments:terminal',[id,'/opt/conda/bin/conda','/opt/conda']],
   ['jupyter:start',[id,'/usr/bin/python3',8888]],
  ] as [string,unknown[]][])await assert.rejects(invoke(name,...args),/SFTP/,name);
  const resources=new ResourceInspection(ssh);await assert.rejects(resources.hardware(id),/SFTP/);await assert.rejects(resources.processes(id),/SFTP/);
  await assert.rejects(services.docker.api(id,'GET','/_ping'),/SFTP/);
  await assert.rejects(new LinuxWorkspaceService(ssh,'unused-payload').plan(id),/SFTP/);
  const client=ssh.get(id).client;
  const denied=(method:string,args:unknown[])=>new Promise((resolve,reject)=>(client as any)[method](...args,(error:Error)=>error?reject(error):resolve(undefined)));
  for(const [method,args] of [['exec',['true']],['shell',[]],['subsys',['custom-shell']],['forwardOut',['127.0.0.1',0,'127.0.0.1',80]],['forwardIn',['127.0.0.1',0]],['openssh_forwardOutStreamLocal',['/var/run/docker.sock']]] as [string,unknown[]][])await assert.rejects(denied(method,args),/SFTP/,method);
  const noop=()=>{};assert.equal(client.on('ready',noop),client,'fluent lifecycle methods never expose the unrestricted client');client.off('ready',noop);
  assert.equal(remote.execRequests(),0);assert.equal(remote.forwardRequests(),0);assert.equal(remote.shellRequests(),0);
  // Refusals leave the authorized SFTP connection usable.
  assert.ok((await ssh.list(id,'/')).entries.some(e=>e.name==='hello.txt'));
  await manager.disconnect(id);
 }finally{ssh.dispose();await remote.close();await rm(directory,{recursive:true,force:true});}
});
