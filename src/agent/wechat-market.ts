import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const supportedVersions = ['4.1.15.56','4.2.0.12','4.2.0.50'];
const features = [
  ['wechat.contacts.read','查询通讯录'], ['wechat.send','发送文本'], ['wechat.events.read','接收消息与事件订阅'],
  ['wechat.history.read','历史查询'], ['wechat.moments.read','读取朋友圈'], ['wechat.files.send','发送文件'],
  ['wechat.transfers.receive','接收转账'], ['wechat.redpackets.receive','接收红包'],
] as const;
export function wechatSupport(versions:readonly string[], permissions:readonly string[]=[]){
 const installable=versions.length===1&&supportedVersions.includes(versions[0]);
 const reason=installable?'安装后绑定并核验本机微信。':versions.includes('4.1.15.50')?'微信 4.1.15.50 已因原生组件稳定性问题隔离，不能安装或调用。':versions.length>1?'检测到多个微信版本，请仅运行一个支持版本。':versions.length?'当前微信版本尚未验证，不能安装或调用。':'请先打开本机微信，再刷新应用市场。';
 const available = (permission:string) => installable && permissions.includes(permission);
 return {installable,reason,capabilities:features.filter(([permission])=>available(permission)).map(([,label])=>label), unavailable:features.filter(([permission])=>!available(permission)).map(([,label])=>label)};
}
export function selectWechatMarket<T extends {id:string;name:string;description:string;installed?:boolean;permissions?:readonly string[]}>(entries:T[], versions:readonly string[]):Array<T & {wechatSupport?:ReturnType<typeof wechatSupport>} >{
  const wechat=entries.filter(x=>x.id==='cagent.wechat'||/^cagent\.wechat\.v\d+$/.test(x.id));
  if(!wechat.length)return entries;
  const matched=versions.length===1?wechat.find(x=>x.id==='cagent.wechat.v'+versions[0].replaceAll('.','')):undefined;
  const support=wechatSupport(versions,matched?.permissions);
  const selected=matched??wechat.find(x=>x.id!=='cagent.wechat')??wechat[0];
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
