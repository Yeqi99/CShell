import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import type {Store} from '../core/store';
import {localHttpProxy} from '../core/local-http-proxy';
import type {HttpTunnel} from '../core/http-transport';
const exec=promisify(execFile);
const stateSchema=z.object({ProxyEnable:z.number().nullable(),ProxyServer:z.string().nullable(),ProxyOverride:z.string().nullable(),AutoConfigURL:z.string().nullable(),AutoDetect:z.number().nullable()}).strict();
export type SystemProxyState=z.infer<typeof stateSchema>;
const key='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const notify=`Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class ProxyNotify{[DllImport("wininet.dll",SetLastError=true)]public static extern bool InternetSetOption(IntPtr h,int o,IntPtr b,int n);}';[ProxyNotify]::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0)|Out-Null;[ProxyNotify]::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0)|Out-Null`;
async function powershell(script:string){return (await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from("$ErrorActionPreference='Stop';"+script,'utf16le').toString('base64')],{windowsHide:true,timeout:15000,maxBuffer:32768})).stdout.trim();}
export class WindowsSystemProxy{
 beforeEnable?:(state:SystemProxyState)=>Promise<void>;
 afterDisable?:()=>Promise<void>;
 private listener?:Awaited<ReturnType<typeof localHttpProxy>>;private queue=Promise.resolve();private error='';
 constructor(private directory:string,private store:Pick<Store,'encryptPrivate'|'decryptPrivate'>,private tunnel:HttpTunnel,private prepare:()=>Promise<void>,private platform=process.platform,private run=powershell){}
 private file(){return join(this.directory,'system-proxy-recovery.enc');}
 private async read():Promise<SystemProxyState>{return stateSchema.parse(JSON.parse(await this.run(`$p=Get-ItemProperty -LiteralPath '${key}';@{ProxyEnable=$p.ProxyEnable;ProxyServer=$p.ProxyServer;ProxyOverride=$p.ProxyOverride;AutoConfigURL=$p.AutoConfigURL;AutoDetect=$p.AutoDetect}|ConvertTo-Json -Compress`)));}
 private async write(value:SystemProxyState){const encoded=Buffer.from(JSON.stringify(value)).toString('base64');await this.run(`$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))|ConvertFrom-Json;$key='${key}';foreach($name in @('ProxyEnable','ProxyServer','ProxyOverride','AutoConfigURL','AutoDetect')){if($null -eq $p.$name){Remove-ItemProperty -LiteralPath $key -Name $name -ErrorAction SilentlyContinue}else{$kind=if($name -in @('ProxyEnable','AutoDetect')){'DWord'}else{'String'};New-ItemProperty -LiteralPath $key -Name $name -Value $p.$name -PropertyType $kind -Force|Out-Null}};${notify}`);}
 async recover(){if(this.platform!=='win32')return;try{const saved=z.object({previous:stateSchema,applied:stateSchema}).strict().parse(JSON.parse(await this.store.decryptPrivate(await readFile(this.file(),'utf8'))));const current=await this.read();if(JSON.stringify(current)===JSON.stringify(saved.applied))await this.write(saved.previous);await unlink(this.file());this.error='';}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'){this.error='系统代理恢复未完成，请在 Windows 网络设置检查原代理';throw error;}}}
 status(){return {supported:this.platform==='win32',enabled:!!this.listener,error:this.error};}
 async set(enabled:boolean){const task=this.queue.catch(()=>{}).then(async()=>{if(this.platform!=='win32')throw Error('此平台暂不支持系统代理接管');if(enabled===!!this.listener)return this.status();
  if(!enabled){await this.recover();this.listener?.close();this.listener=undefined;await this.afterDisable?.();return this.status();}
  await this.recover();await this.prepare();const previous=await this.read();await this.beforeEnable?.(previous);const listener=await localHttpProxy(this.tunnel).catch(async error=>{await this.afterDisable?.();throw error;});
  const applied:SystemProxyState={ProxyEnable:1,ProxyServer:'http=127.0.0.1:'+listener.port+';https=127.0.0.1:'+listener.port,ProxyOverride:'',AutoConfigURL:null,AutoDetect:0};
  try{await writeFile(this.file()+'.tmp',await this.store.encryptPrivate(JSON.stringify({previous,applied})),{mode:0o600});await rename(this.file()+'.tmp',this.file());await this.write(applied);this.listener=listener;this.error='';}catch(error){listener.close();await this.recover().catch(()=>{});await this.afterDisable?.();throw error;}
  return this.status();});this.queue=task.then(()=>{},()=>{});return task;}
 async close(){await this.queue;if(this.platform!=='win32')return;await this.set(false);}
}
