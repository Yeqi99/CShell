import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { profileSchema, type Profile } from '../shared/contracts';

export const rdpProfileSchema=profileSchema.refine(p=>p.protocol==='rdp' && p.auth==='password' && /^[a-zA-Z0-9.:-]+$/.test(p.host) && !/[\r\n\0]/.test(p.username),'Invalid Remote Desktop profile');
export function rdpDocument(value:Profile,encrypted?:string){
 const p=rdpProfileSchema.parse(value);
 if(encrypted&&!/^[A-F0-9]+$/i.test(encrypted))throw new Error('Invalid protected password');
 const host=p.host.includes(':')?`[${p.host}]`:p.host;
 return '\ufeff'+[`full address:s:${host}:${p.port}`,`username:s:${p.username}`,'authentication level:i:2','enablecredsspsupport:i:1',
  ...(encrypted?[`password 51:b:${encrypted}`,'prompt for credentials:i:0']:['prompt for credentials:i:1'])].join('\r\n')+'\r\n';
}
export function protectRdpPassword(password:string):Promise<string>{
 z.string().max(16000).parse(password);
 // Fixed program; the secret travels only through stdin, never command arguments.
 const script="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); try { $p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([BitConverter]::ToString($p).Replace('-','')) } finally { [Array]::Clear($b,0,$b.Length) }";
 return new Promise((resolve,reject)=>{
  const child=spawn(join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='',done=false;const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(output);};
  const timer=setTimeout(()=>{child.kill();finish(new Error('Windows password protection timed out'));},15000);
  child.stdout.on('data',b=>{output+=b.toString();if(output.length>100000){child.kill();finish(new Error('Invalid protected password'));}});
  child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});child.on('error',()=>finish(new Error('Windows password protection unavailable')));
  child.on('close',code=>finish(code===0&&/^[A-F0-9]+$/.test(output)?undefined:new Error('Windows password protection failed')));
  child.stdin.end(Buffer.from(password,'utf16le').toString('base64'));
 });
}
export async function openRdpProfile(profile:Profile,password:string|undefined,directory:string){
 if(process.platform!=='win32')throw new Error('RDP requires Windows');
 const p=rdpProfileSchema.parse(profile);
 const protectedPassword=password?await protectRdpPassword(password):undefined;
 await mkdir(directory,{recursive:true});
 const file=join(directory,p.id+'.rdp');
 await writeFile(file,rdpDocument(p,protectedPassword),{encoding:'utf16le',mode:0o600});
 await new Promise<void>((resolve,reject)=>{
  const child=spawn(join(process.env.SystemRoot||'C:/Windows','System32/mstsc.exe'),[file],{detached:true,stdio:'ignore'});
  child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
 });
}
