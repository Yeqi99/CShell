import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export function wechatSupport(versions:readonly string[]){
 const installable=versions.length===1&&['4.1.15.56','4.2.0.12'].includes(versions[0]);
 const reason=installable?'支持聊天发送与消息订阅；安装后仍需绑定并核验本机微信。':versions.includes('4.1.15.50')?'微信 4.1.15.50 已因原生组件稳定性问题隔离，不能安装或调用。':versions.length>1?'检测到多个微信版本，请仅运行一个支持版本。':versions.length?'当前微信版本尚未验证，不能安装或调用。':'请先打开本机微信，再刷新应用市场。';
 return {installable,reason,capabilities:installable?['发送文本','接收消息与事件订阅']:[],unavailable:['通讯录与历史查询','朋友圈与文件发送','转账与红包操作']};
}
export function selectWechatMarket<T extends {id:string;name:string;description:string;installed?:boolean}>(entries:T[], versions:readonly string[]):Array<T & {wechatSupport?:ReturnType<typeof wechatSupport>} >{
  const wechat=entries.filter(x=>x.id==='cagent.wechat'||/^cagent\.wechat\.v\d+$/.test(x.id));
  if(!wechat.length)return entries;
  const support=wechatSupport(versions);
  const matched=support.installable?wechat.find(x=>x.id==='cagent.wechat.v'+versions[0].replaceAll('.','')):undefined;
  const selected=matched??wechat.find(x=>/^cagent\.wechat\.v(?:411556|42012)$/.test(x.id))??wechat[0];
  if(!matched&&support.installable){support.installable=false;support.reason='当前目录缺少匹配版本的能力包，请更新应用目录。';support.capabilities=[];}
  return entries.filter(x=>!wechat.includes(x)).concat([{...selected,name:'微信工具',description:support.reason,wechatSupport:support}]);
}

export async function runningWechatVersions():Promise<string[]> {
  if(process.platform!=='win32')return [];
  const script="$ErrorActionPreference='Stop'; @(Get-Process -Name Weixin,WeChat -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Path) { (Get-Item -LiteralPath $_.Path).VersionInfo.FileVersion } }) | ConvertTo-Json -Compress";
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:5000,maxBuffer:16384});
  const parsed=stdout.trim()?JSON.parse(stdout):[];
  return [...new Set((Array.isArray(parsed)?parsed:[parsed]).filter((x):x is string=>typeof x==='string').map(x=>x.trim()).filter(x=>/^\d+\.\d+\.\d+\.\d+$/.test(x)))];
}

export function requireWechatVersion(id:string,versions:readonly string[]){
  if(id!=='cagent.wechat'&&!/^cagent\.wechat\.v\d+$/.test(id))return;
  const support=wechatSupport(versions);
  if(!support.installable||id!=='cagent.wechat.v'+versions[0].replaceAll('.',''))throw Error(support.installable?'工具包与正在运行的微信版本不匹配。':support.reason);
}
