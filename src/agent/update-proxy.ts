import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
export function parseUpdateProxy(value:string):string{
 const normalized=value.includes('://')?value:'http://'+value;
 const url=new URL(normalized);
 if(!['http:','https:'].includes(url.protocol)||url.pathname!=='/'||url.search||url.hash)throw Error('更新代理仅支持 HTTP/HTTPS CONNECT');
 return url.href;
}
export function windowsUpdateProxy(settings:{enabled?:number;server?:string;pac?:string;autoDetect?:number}):string|undefined{
 if(settings.pac||settings.autoDetect===1)throw Error('CAgent 更新暂不支持 PAC/WPAD，请为更新进程配置 HTTPS_PROXY');
 if(settings.enabled!==1)return undefined;
 const entries=(settings.server??'').split(';').filter(Boolean);
 const selected=entries.some(x=>x.includes('='))?entries.find(x=>x.toLowerCase().startsWith('https='))?.slice(6)??entries.find(x=>x.toLowerCase().startsWith('http='))?.slice(5):entries[0];
 if(!selected)throw Error('系统更新代理配置无效');return parseUpdateProxy(selected);
}
export async function systemUpdateProxy(url:string):Promise<string|undefined>{
 const host=new URL(url).hostname;
 // Local fixtures and local services never leave loopback through a system proxy.
 if(['localhost','127.0.0.1','[::1]'].includes(host))return undefined;
 const env=process.env.HTTPS_PROXY||process.env.https_proxy||process.env.ALL_PROXY||process.env.all_proxy||process.env.HTTP_PROXY||process.env.http_proxy;
 if(env)return parseUpdateProxy(env);
 if(process.platform!=='win32')return undefined;
 const script="$p=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction Stop; @{enabled=$p.ProxyEnable;server=$p.ProxyServer;pac=$p.AutoConfigURL;autoDetect=$p.AutoDetect}|ConvertTo-Json -Compress";
 try{const{stdout}=await promisify(execFile)('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:5000,maxBuffer:16384});return windowsUpdateProxy(JSON.parse(stdout));}catch(error){if(error instanceof Error&&error.message.includes('CAgent 更新'))throw error;throw Error('无法读取系统更新代理，未回退直连');}
}
