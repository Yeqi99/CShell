import type {SFTPWrapper,Stats} from 'ssh2';
import {remotePath} from './paths';
export type FilePermissions={mode:number;uid:number;gid:number;directory:boolean};
const invoke=<T>(fn:(cb:(error:Error|undefined|null,value:T)=>void)=>void)=>new Promise<T>((resolve,reject)=>fn((e,v)=>e?reject(e):resolve(v)));
const info=(s:Stats):FilePermissions=>({mode:s.mode&0o7777,uid:s.uid,gid:s.gid,directory:s.isDirectory()});
export async function filePermissions(sftp:SFTPWrapper,path:string,change?:{mode:number;expectedMode:number}):Promise<FilePermissions>{
 remotePath(path);
 const before=await invoke<Stats>(cb=>sftp.lstat(path,cb));
 if(before.isSymbolicLink())throw Error('符号链接不提供权限编辑，请打开实际目标目录');
 if(!before.isFile()&&!before.isDirectory())throw Error('仅支持普通文件和目录');
 if(!change)return info(before);
 if(!Number.isInteger(change.mode)||change.mode<0||change.mode>0o777||!Number.isInteger(change.expectedMode))throw Error('权限必须是 000–777');
 // Bind the mutation to one opened remote handle, not a path that may be replaced.
 const handle=await invoke<Buffer>(cb=>sftp.open(path,'r',cb));
 try{
  const current=await invoke<Stats>(cb=>sftp.fstat(handle,cb));
  if((current.mode&0o7777)!==change.expectedMode||current.uid!==before.uid||current.gid!==before.gid||current.isDirectory()!==before.isDirectory())throw Error('权限或目标已改变，请重新读取后修改');
  await invoke<void>(cb=>sftp.fchmod(handle,(current.mode&0o7000)|change.mode,e=>cb(e,undefined)));
  const updated=await invoke<Stats>(cb=>sftp.fstat(handle,cb));
  if((updated.mode&0o777)!==change.mode)throw Error('服务器未应用所选权限，请重新读取确认');
  return info(updated);
 }finally{await invoke<void>(cb=>sftp.close(handle,e=>cb(e,undefined))).catch(()=>{});}
}
