import {app} from 'electron';
import {spawn} from 'node:child_process';
import {copyFile,mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';

export async function readAccountSource(source:string,edition:'opensource'|'pro'){
 const temporary=await mkdtemp(join(tmpdir(),'cshell-source-reader-'));
 const base=await realpath(tmpdir()),resolved=await realpath(temporary),rel=relative(base,resolved);
 if(rel.startsWith('..')||isAbsolute(rel))throw Error('临时读取目录不正确');
 try{
  await copyFile(join(source,'Local State'),join(temporary,'Local State')).catch(error=>{if(error.code!=='ENOENT')throw error;});
  const args=[...(app.isPackaged?[]:[join(__dirname,'main.cjs')]),'--account-source-export',source,temporary,edition];
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.CSHELL_TEST_DATA;
  return await new Promise<unknown>((resolve,reject)=>{
   const child=spawn(process.execPath,args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
   const chunks:Buffer[]=[];let size=0,failed=false;
   const fail=()=>{if(failed)return;failed=true;child.kill();};
   const timer=setTimeout(fail,45000);
   child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>90*1024*1024)fail();else chunks.push(chunk);});
   // Diagnostics are deliberately not forwarded: decoder failures can contain private values.
   child.stderr.resume();
   child.on('error',()=>{clearTimeout(timer);reject(Error('配置读取进程无法启动'));});
   child.on('close',code=>{clearTimeout(timer);if(failed||code!==0){reject(Error('无法安全读取来源配置，原文件已保留'));return;}try{const text=Buffer.concat(chunks).toString('utf8').trimStart();if(!text.startsWith('CSHELL_SOURCE_V1\n'))throw Error();resolve(JSON.parse(text.slice(17)));}catch{reject(Error('来源配置读取结果不完整，未载入任何信息'));}});
  });
 }finally{await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}


