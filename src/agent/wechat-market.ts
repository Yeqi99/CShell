import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export function selectWechatMarket<T extends {id:string;name:string;description:string;installed?:boolean}>(entries:T[], versions:readonly string[]):T[]{
  const wechat=entries.filter(x=>x.id==='cagent.wechat'||/^cagent\.wechat\.v\d+$/.test(x.id));
  if(!wechat.length)return entries;
  const supported=wechat.filter(x=>versions.length===1&&versions.some(v=>x.id==='cagent.wechat.v'+v.replaceAll('.','')||(x.id==='cagent.wechat'&&v==='4.1.15.50'&&!wechat.some(other=>other.id==='cagent.wechat.v411550'))));
  const selected=supported.length===1?supported[0]:wechat.find(x=>x.installed)??wechat[0];
  const description=supported.length===1?'已检测微信 '+versions[0]+'，安装匹配的已验证工具包。':versions.length?'当前微信版本尚未适配，或存在多个版本；请仅运行一个支持的微信版本。':'请先打开本机微信，安装时会自动匹配已验证版本。';
  return entries.filter(x=>!wechat.includes(x)).concat([{...selected,name:'微信工具',description}]);
}

export async function runningWechatVersions():Promise<string[]> {
  if(process.platform!=='win32')return [];
  const script="$ErrorActionPreference='Stop'; @(Get-Process -Name Weixin,WeChat -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Path) { (Get-Item -LiteralPath $_.Path).VersionInfo.FileVersion } }) | ConvertTo-Json -Compress";
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:5000,maxBuffer:16384});
  const parsed=stdout.trim()?JSON.parse(stdout):[];
  return [...new Set((Array.isArray(parsed)?parsed:[parsed]).filter((x):x is string=>typeof x==='string').map(x=>x.trim()).filter(x=>/^\d+\.\d+\.\d+\.\d+$/.test(x)))];
}

export function requireWechatVersion(id:string,versions:readonly string[]){
  if(!/^cagent\.wechat\.v\d+$/.test(id))return;
  if(versions.length!==1||id!=='cagent.wechat.v'+versions[0].replaceAll('.',''))throw Error('请先打开一个已支持版本的本机微信，再刷新应用市场；未安装不匹配的工具包。');
}
