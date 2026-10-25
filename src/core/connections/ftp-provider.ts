import {createHash} from 'node:crypto';import {z} from 'zod';
import {FtpService,ftpConfiguration,type FtpProfile} from '../ftp';
import type {ManagedProvider} from './manager';import type {ProviderConnection,ConnectionTool} from './contracts';
export const ftpIdentity=(p:Pick<FtpProfile,'protocol'|'host'|'port'|'username'>)=>createHash('sha256').update(JSON.stringify([p.protocol,p.host,p.port,p.username])).digest('hex');
const path=z.string().min(1).max(4096).refine(s=>!/[\r\n\0]/.test(s));const pathInput=z.object({path}).strict();
const mutationWarning='FTP 变更不保证与其他写入者原子互斥。断线或取消后的结果必须先检查，不能自动重试。';
export class FtpConnectionProvider implements ManagedProvider {
 readonly id='cshell.ftp';readonly version='1.0.0';readonly configuration=ftpConfiguration;
 readonly capabilities=['files.read','files.create','files.rename','files.delete','directories.create','directories.manage'];
 private connections=new WeakMap<object,ProviderConnection>();
 constructor(private ftp:FtpService){}
 async connect(configuration:unknown,credentials:unknown,signal:AbortSignal,ready?:(id:string)=>void){const secret=z.object({password:z.string().optional()}).strict().parse(credentials);return(await this.ftp.connect(configuration,secret,signal,ready)).sessionId;}
 disconnect(id:string){this.ftp.disconnect(id);}
 resolve(id:string){const session=this.ftp.get(id),existing=this.connections.get(session);if(existing)return existing;
  const tools:ConnectionTool[]=[
   {name:'list_files',capability:'files.read',description:'列出当前 FTP/FTPS 连接的真实目录；最多 10000 项，无终端能力。',input:pathInput,needsReview:()=>false,invoke:async(a,s)=>JSON.stringify(await this.ftp.list(id,pathInput.parse(a).path,s))},
   {name:'ftp_read_text',capability:'files.read',description:'读取一个普通 UTF-8 文本文件，最多 64 KiB；不跟随符号链接。',input:pathInput,needsReview:()=>false,invoke:async(a,s)=>JSON.stringify(await this.ftp.readText(id,pathInput.parse(a).path,s))},
   {name:'ftp_create_text',capability:'files.create',description:'创建一个尚不存在的 UTF-8 文件，最多 256 KiB。'+mutationWarning,input:z.object({path,content:z.string().max(262144),acceptNonAtomic:z.literal(true)}).strict(),needsReview:()=>true,conflictDomain:(a:any)=>'file:'+a.path,invoke:async(a:any,s,_output,guard)=>{await this.ftp.writeText(id,a.path,a.content,s,guard);return JSON.stringify({created:true,path:a.path});}},
   {name:'ftp_create_directory',capability:'directories.create',description:'创建一个不存在的目录，不递归创建父目录。'+mutationWarning,input:z.object({path,acceptNonAtomic:z.literal(true)}).strict(),needsReview:()=>true,invoke:async(a:any,s,_output,guard)=>{await this.ftp.action(id,{action:'mkdir',path:a.path},s,guard);return JSON.stringify({created:true,path:a.path});}},
   {name:'ftp_rename',capability:'files.rename',description:'将普通文件重命名到尚不存在的目标，不复制或覆盖。'+mutationWarning,input:z.object({path,destination:path,acceptNonAtomic:z.literal(true)}).strict(),needsReview:()=>true,conflictDomain:(a:any)=>['file:'+a.path,'file:'+a.destination],invoke:async(a:any,s,_output,guard)=>{await this.ftp.action(id,{action:'rename',path:a.path,destination:a.destination,directory:false},s,guard);return JSON.stringify({renamed:true,path:a.path,destination:a.destination});}},
   ...[false,true].map(directory=>({name:directory?'ftp_delete_empty_directory':'ftp_delete_file',capability:directory?'directories.manage':'files.delete',description:(directory?'只删除空目录，不递归。':'永久删除一个普通文件。')+mutationWarning,input:z.object({path,acceptNonAtomic:z.literal(true)}).strict(),needsReview:()=>true,conflictDomain:(a:any)=>'file:'+a.path,invoke:async(a:any,s:AbortSignal,_output:((text:string)=>void)|undefined,guard:(()=>void)|undefined)=>{await this.ftp.action(id,{action:'delete',path:a.path,directory},s,guard);return JSON.stringify({deleted:true,path:a.path});}})),
  ];
  const connection:ProviderConnection={target:{providerId:this.id,resourceId:session.profile.id,identity:ftpIdentity(session.profile),label:session.profile.name||session.profile.host},tools,files:{list:path=>this.ftp.list(id,path)}};
  this.connections.set(session,connection);return connection;
 }
}
