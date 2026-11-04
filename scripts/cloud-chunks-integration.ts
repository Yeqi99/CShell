import {spawn} from 'node:child_process';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve,sep} from 'node:path';import {randomUUID} from 'node:crypto';import {once} from 'node:events';import assert from 'node:assert/strict';
import {chunkVault} from '../src/core/cloud-chunks';import {encryptVault,decryptVault,newRecoveryKey} from '../src/core/cloud-crypto';
import {CloudSync} from '../src/core/cloud-sync';
const root=await mkdtemp(join(tmpdir(),'cshell-chunks-'));const python='C:/Users/35097/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const code=`import os,time
from server import Service,BoundedServer,handler
s=Service(os.environ['TEST_DB'],b'x'*32,lambda *a:None)
with s.db() as db:
 db.execute('INSERT INTO accounts VALUES(?,?)',('account','test@example.com'))
 db.execute('INSERT INTO sessions VALUES(?,?,?)',(s.digest('fffffffffffffffffffffffffffffffffffffffffff'),'account',time.time()+600))
 db.execute('INSERT INTO storage_grants VALUES(?,?,?,?)',('fixture','account',128*1024**2,time.time()+600))
server=BoundedServer(('127.0.0.1',0),handler(s));print(server.server_port,flush=True);server.serve_forever()
`;
const processServer=spawn(python,['-c',code],{env:{...process.env,PYTHONPATH:resolve('services/cloud-sync'),TEST_DB:join(root,'db')},stdio:['ignore','pipe','inherit']});
try{
 const [port]=await once(processServer.stdout,'data');const endpoint=`http://127.0.0.1:${String(port).trim()}/v1/vault/chunks`;let failPut=true,failGet=true;const puts=new Map<number,number>(),gets=new Map<number,number>();
 const request=async(body?:any)=>{const r=await fetch(endpoint,{method:body?'POST':'GET',headers:{Authorization:'Bearer fffffffffffffffffffffffffffffffffffffffffff','Content-Type':'application/json','X-CShell-Vault-Schema':'4','X-CShell-Vault-Write-Schema':'4','X-CShell-Vault-Transport':'1','X-CShell-Vault-Max-Bytes':String(256*1024**2)},...(body?{body:JSON.stringify(body)}:{})});const result=await r.json();if(!r.ok)throw Object.assign(Error(result.error),{status:r.status});if(body?.action==='put'){puts.set(body.part,(puts.get(body.part)||0)+1);if(body.part===2&&failPut){failPut=false;throw Error('simulated lost upload response');}}if(body?.action==='get'){gets.set(body.part,(gets.get(body.part)||0)+1);if(body.part===2&&failGet){failGet=false;throw Error('simulated interrupted download');}}return result;};
 const key=newRecoveryKey(),payload='x'.repeat(65*1024**2);const envelope=encryptVault({payload},key,'account');const upload={baseRevision:0,mutationId:randomUUID(),envelope};
 await assert.rejects(chunkVault(request,join(root,'cache'),upload));const result=await chunkVault(request,join(root,'cache'),upload);assert.equal(result.revision,1);assert.equal(puts.get(2),1);
 await assert.rejects(chunkVault(request,join(root,'cache')));const downloaded=await chunkVault(request,join(root,'cache'));assert('envelope'in downloaded&&downloaded.envelope);assert.equal((decryptVault(downloaded.envelope!,key,'account') as any).payload.length,payload.length);assert.equal(gets.get(0),1);
 const localKey=newRecoveryKey(),codec={encrypt:async(value:string)=>JSON.stringify(encryptVault(value,localKey,'local')),decrypt:async(value:string)=>decryptVault(JSON.parse(value),localKey,'local') as string};
 const snapshot={payload:'y'+payload.slice(1),store:{accountPreferences:{autoDiscoverDevices:true}}};
 const cloud=new CloudSync(join(root,'desktop-a'),codec,{export:async()=>snapshot,import:async()=>{},validate:()=>{}},endpoint.replace('/v1/vault/chunks',''));
 (cloud as any).data={session:{accountId:'account',email:'test@example.com',token:'fffffffffffffffffffffffffffffffffffffffffff'},key,revision:1};
 await cloud.sync('upload');assert.equal(cloud.status().revision,2);
 let restored:any={};const second=new CloudSync(join(root,'desktop-b'),codec,{export:async()=>restored,import:async(value)=>{restored=value},validate:()=>{}},endpoint.replace('/v1/vault/chunks',''));
 (second as any).data={session:{accountId:'account',email:'test@example.com',token:'fffffffffffffffffffffffffffffffffffffffffff'},key,revision:0};
 await second.sync('download');assert.equal(restored.payload,snapshot.payload);
 console.log(JSON.stringify({passed:true,payloadMiB:65,uploadParts:puts.size,downloadParts:gets.size,rssMiB:Math.round(process.memoryUsage().rss/1024**2),maxRssMiB:Math.round(process.resourceUsage().maxRSS/1024),checks:['real HTTP encrypted roundtrip','lost upload response resumes','download cache resumes','AES-GCM verification','full CloudSync upload and second-device restore including encrypted state/backups']}));
}finally{processServer.kill();await once(processServer,'exit');const target=resolve(root);if(target.startsWith(resolve(tmpdir())+sep)&&target.includes('cshell-chunks-'))await rm(target,{recursive:true,force:true});}
