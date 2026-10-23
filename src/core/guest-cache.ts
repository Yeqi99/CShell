import {lstat,realpath,rm} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname,sep} from 'node:path';

// Only portable guest configuration and Chromium browsing data. Never recurse the profile root.
export const guestCacheEntries=['config.json','ai-drafts.enc','network-route.enc','ai.enc','opencode.enc','http.enc','client-controller/devices.enc','machine-browser','appearance','Network','Local Storage','Session Storage','IndexedDB','Cache','Code Cache','GPUCache','Service Worker'] as const;
export async function clearGuestCache(directory:string,currentDirectory:string){
 const root=await realpath(directory),current=await realpath(currentDirectory);
 if(root===current)throw Error('不能清除正在使用的工作区');
 const targets:string[]=[];
 for(const name of guestCacheEntries){
  const path=resolve(root,name),rel=relative(root,path);
  if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('缓存路径不安全');
  try{
   const info=await lstat(path),actual=await realpath(path),parent=await realpath(dirname(path));
   const actualRel=relative(root,actual),parentRel=relative(root,parent);
   if(info.isSymbolicLink()||actualRel.startsWith('..')||isAbsolute(actualRel)||parentRel.startsWith('..')||isAbsolute(parentRel)||actual===current||current.startsWith(actual+sep))throw Error('缓存位置已改变，未执行清除');
   targets.push(path);
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 }
 // Preflight every resolved absolute path before deleting anything. Identity, cloud auth,
 // other accounts and the original open-source folder are never selected.
 for(const path of targets){
  try{await rm(path,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
  catch{throw Error('未登录数据未全部清除，部分文件可能正在使用。账号数据未清除，请稍后重试。');}
 }
}
