import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute,join} from 'node:path';
import {networkInterfaces} from 'node:os';
import {systemExitConfig,linuxSystemExitGuard,type SystemExitRuntime,type SystemExitInput} from '../core/system-network-exit';
const exec=promisify(execFile);
type PackageFile={path:string;sha256:string};
async function verified(file:PackageFile){if(!isAbsolute(file.path)||! /^[a-f0-9]{64}$/.test(file.sha256))throw Error('SYSTEM_EXIT_PACKAGE_UNVERIFIED');const data=await readFile(file.path);if(createHash('sha256').update(data).digest('hex')!==file.sha256)throw Error('SYSTEM_EXIT_PACKAGE_CHANGED');}
/** Used only by the separately authorized privileged capability process, never auto-started by cloud sync. */
export class NativeSystemExitRuntime implements SystemExitRuntime {
 constructor(private options:{directory:string;engine:PackageFile;guard?:PackageFile;controllerExecutable:string;input:SystemExitInput;linuxControlUid?:number;control:{address:string;port:number}[];authorize:SystemExitRuntime['authorize']}){}
 authorize(plan:Parameters<SystemExitRuntime['authorize']>[0]){return this.options.authorize(plan);}
 private async run(path:string,args:string[],input?:string){return await new Promise<string>((resolve,reject)=>{const p=spawn(path,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';let errors='';const timeout=setTimeout(()=>{p.kill();reject(Error('SYSTEM_EXIT_HELPER_TIMEOUT'))},15000);p.stdout.on('data',b=>output=(output+b).slice(-65536));p.stderr.on('data',b=>errors=(errors+b).slice(-2048));p.once('error',e=>{clearTimeout(timeout);reject(e)});p.once('exit',code=>{clearTimeout(timeout);code===0?resolve(output):reject(Error('SYSTEM_EXIT_HELPER_FAILED '+errors));});p.stdin.end(input);});}
 async preflight(){
  if(process.platform!==this.options.input.platform)throw Error('SYSTEM_EXIT_PLATFORM_MISMATCH');await verified(this.options.engine);
  if(Object.keys(networkInterfaces()).some(name=>/tun|tap|wireguard|tailscale|zerotier|clash|vpn/i.test(name)))throw Error('SYSTEM_EXIT_OTHER_VPN_PRESENT');
  if(process.platform==='win32'){
   if(!this.options.guard)throw Error('SYSTEM_EXIT_GUARD_NOT_INSTALLED');await verified(this.options.guard);
   const result=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command','([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{windowsHide:true});if(result.stdout.trim()!=='True')throw Error('SYSTEM_EXIT_ADMIN_REQUIRED');
  }else{if(process.getuid?.()!==0)throw Error('SYSTEM_EXIT_ADMIN_REQUIRED');const uid=this.options.linuxControlUid;if(!uid||uid===process.getuid?.())throw Error('SYSTEM_EXIT_DEDICATED_CONTROL_UID_REQUIRED');await this.run('nft',['--version']);}
  await mkdir(this.options.directory,{recursive:true});const path=join(this.options.directory,'engine.json');await writeFile(path,JSON.stringify(systemExitConfig(this.options.input)),{mode:0o600});await this.run(this.options.engine.path,['check','-c',path]);
 }
 async guardInstall(){
  // Persist recovery facts BEFORE any network mutation. No account secrets in this file.
  const file=join(this.options.directory,'guard-recovery.json');await writeFile(file+'.tmp',JSON.stringify({format:1,platform:process.platform,interfaceName:this.options.input.interfaceName??'cshelltun',explicitRemovalRequired:true}),{mode:0o600});await rename(file+'.tmp',file);
  if(process.platform==='win32')await this.run(this.options.guard!.path,['apply','pending',this.options.controllerExecutable,this.options.engine.path]);
  else{const rules=linuxSystemExitGuard({interfaceName:this.options.input.interfaceName??'cshelltun',controlUid:this.options.linuxControlUid!,control:this.options.control});await this.run('nft',['--check','--file','-'],rules);await this.run('nft',['--file','-'],rules);}
 }
 async guardRemove(){if(process.platform==='win32')await this.run(this.options.guard!.path,['remove']);else await this.run('nft',['delete','table','inet','cshell_system_exit']);}
 async engineStart(config:ReturnType<typeof systemExitConfig>){
  await verified(this.options.engine);const path=join(this.options.directory,'engine.json');await writeFile(path,JSON.stringify(config),{mode:0o600});
  const child=spawn(this.options.engine.path,['run','-c',path],{windowsHide:true,stdio:['ignore','ignore','pipe']});let exited=false,error='';child.once('error',e=>{exited=true;error=e.message});child.once('exit',()=>{exited=true});child.stderr.on('data',b=>{error=(error+b).slice(-2048)});
  return{ready:async()=>{const name=this.options.input.interfaceName??'cshelltun';for(let i=0;i<100;i++){if(exited)throw Error('SYSTEM_EXIT_ENGINE_FAILED '+error);if(networkInterfaces()[name]){if(process.platform==='win32')await this.run(this.options.guard!.path,['allow-tun',name]);return;}await new Promise(r=>setTimeout(r,100));}throw Error('SYSTEM_EXIT_TUN_NOT_READY');},stop:async()=>{if(exited)return;child.kill();await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('SYSTEM_EXIT_STOP_TIMEOUT_GUARD_RETAINED')),10000);child.once('exit',()=>{clearTimeout(timer);resolve()});});}};
 }
}
