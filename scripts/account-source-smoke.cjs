// Isolated Electron storage contexts; never reads the user's installed configuration.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{createHash}=require('node:crypto'),assert=require('node:assert/strict');
const electron=require('electron'),{build}=require('esbuild');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.CSHELL_TEST_DATA;
function run(args){return new Promise((resolve,reject)=>{const child=spawn(electron,args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let chunks=[],size=0;const timeout=setTimeout(()=>child.kill(),30000);child.stdout.on('data',b=>{size+=b.length;if(size>10000000)child.kill();else chunks.push(b);});child.stderr.resume();child.on('error',reject);child.on('close',code=>{clearTimeout(timeout);resolve({code,text:Buffer.concat(chunks).toString()});});});}
async function hashes(root){const result={};async function visit(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await visit(p);else result[path.relative(root,p)]=createHash('sha256').update(await fs.readFile(p)).digest('hex');}}await visit(root);return result;}
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cshell-source-smoke-')),source=path.join(root,'source'),context=path.join(root,'context'),fixture=path.join(root,'fixture.cjs');
 try{
  await fs.mkdir(source);await fs.mkdir(context);
  await build({stdin:{contents:`import {app,safeStorage} from 'electron';import {writeFile,mkdir} from 'node:fs/promises';import {join} from 'node:path';import {Store} from './src/core/store';app.setPath('userData',${JSON.stringify(source)});app.setPath('sessionData',${JSON.stringify(source)});app.whenReady().then(async()=>{const codec={encrypt:async(s)=>(await safeStorage.encryptStringAsync(s)).toString('base64'),decrypt:async(s)=>(await safeStorage.decryptStringAsync(Buffer.from(s,'base64'))).result};const store=new Store(${JSON.stringify(source)},codec);await store.load();const data=await store.cloudExport();data.profiles=[{id:'10000000-0000-4000-8000-000000000001',name:'Fixture',protocol:'ssh',host:'fixture.invalid',port:22,username:'fixture',auth:'password',group:'',favorite:false}];data.secrets={[data.profiles[0].id]:{password:'fixture-secret'}};await store.cloudImport(data);await mkdir(join(${JSON.stringify(source)},'extensions','opencode'),{recursive:true});await writeFile(join(${JSON.stringify(source)},'extensions','opencode','opencode.enc'),await codec.encrypt(JSON.stringify({accounts:[{id:'fixture',name:'Fixture',key:'fixture-opencode-key'}]})));app.quit();}).catch(()=>app.exit(1));`,resolveDir:process.cwd(),loader:'ts'},outfile:fixture,bundle:true,platform:'node',external:['electron']});
  assert.equal((await run([fixture])).code,0,'fixture creation');
  const before=await hashes(source);
  await fs.copyFile(path.join(source,'Local State'),path.join(context,'Local State'));
  const result=await run([path.resolve(process.env.SOURCE_EXPORT_ENTRY||'dist/main/main.cjs'),'--account-source-export',source,context,'pro']);
  assert.equal(result.code,0,'source export');
  const header='CSHELL_SOURCE_V1\n';const output=result.text.trimStart();assert(output.startsWith(header));const data=JSON.parse(output.slice(header.length));
  assert.equal(data.store.secrets[data.store.profiles[0].id].password,'fixture-secret');
  assert.equal(data.opencode.accounts[0].key,'fixture-opencode-key');assert.equal(data.opencode.accounts[0].id,'fixture');
  assert(!('mcp' in data.store));assert(!('plugins' in data.store));
  const after=await hashes(source);assert.deepEqual(after,before,'source must remain byte-for-byte unchanged');
  await fs.writeFile(path.join(source,'extensions','opencode','opencode.enc'),'corrupt');
  const failed=await run([path.resolve(process.env.SOURCE_EXPORT_ENTRY||'dist/main/main.cjs'),'--account-source-export',source,context,'pro']);
  assert.notEqual(failed.code,0);assert(!failed.text.includes('CSHELL_SOURCE_V1'),'failure cannot return partial secrets');
  console.log('PASS source export: encrypted credentials and IDs preserved; grants excluded; originals unchanged; corrupt source fails closed');
 }finally{await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
})().catch(()=>{console.error('FAIL source export smoke (private output suppressed)');process.exitCode=1;});



