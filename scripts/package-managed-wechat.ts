/** Convert a verified binary-only toolkit to the existing authenticated capability format.
 * Run only after native validation. This does not upload or mark a build as released. */
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {z} from 'zod';
import {capabilityDigest,createBundledCapabilityEntry} from '../src/agent/capability-catalog';
import {agentCapabilityManifestSchema} from '../src/shared/agent-capability-packages';
import {managedWechatVersions,assertManagedWechatPackage} from '../src/agent/managed-wechat-capability';
import {verifyCapabilityFiles} from '../src/agent/capability-packages';

const [runtimeArg,declarationArg,outputArg]=process.argv.slice(2);
if(!runtimeArg||!declarationArg||!outputArg)throw Error('Usage: tsx scripts/package-managed-wechat.ts <verified binary directory> <capability declaration.json> <output directory>');
const runtime=resolve(runtimeArg),output=resolve(outputArg);
const record=z.object({entry:z.literal('WeixinToolkit.exe'),wechatVersion:z.enum(managedWechatVersions),moduleSha256:z.string().regex(/^[a-f0-9]{64}$/),files:z.record(z.string(),z.string().regex(/^[a-f0-9]{64}$/))}).passthrough().parse(JSON.parse(await readFile(join(runtime,'manifest.json'),'utf8')));
const declaration=agentCapabilityManifestSchema.parse(JSON.parse(await readFile(resolve(declarationArg),'utf8')));
assertManagedWechatPackage(record.wechatVersion,record.moduleSha256,declaration);
if(declaration.license!=='Proprietary'||!declaration.id.startsWith('cagent.wechat.'))throw Error('Expected closed-source WeChat declaration');
const files:Record<string,Buffer>={};let bytes=0;
for(const [path,digest] of Object.entries(record.files)){
 const full=resolve(runtime,path),within=relative(runtime,full);
 if(!within||within.startsWith('..')||isAbsolute(within)||path.includes('\\')||path.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Invalid binary path');
 if(/\.(?:py|pyw|c|cpp|h|js|ts|map|log|dmp|sqlite|db)$/i.test(path)||/(?:^|\/)(?:config|binding|validation|chat-validation|installation)\.json$/i.test(path))throw Error('Implementation source or local state in release: '+path);
 if(!(await lstat(full)).isFile()||(await lstat(full)).isSymbolicLink())throw Error('Invalid binary file');
 const data=await readFile(full);if(capabilityDigest(data)!==digest)throw Error('Binary digest mismatch: '+path);
 bytes+=data.length;if(bytes>180*1024*1024)throw Error('Binary package exceeds materialized budget');files[path]=data;
}
if(!files[record.entry])throw Error('Runtime executable missing');
files['toolkit-manifest.json']=await readFile(join(runtime,'manifest.json'));
const entry=createBundledCapabilityEntry(declaration,files);
if(entry.bundleBytes>256*1024*1024)throw Error('Encoded package exceeds download budget');
const parsed=agentCapabilityManifestSchema.parse(JSON.parse(JSON.parse(entry.bundle!).manifest));
// Validate portable paths and declared binary bytes before producing an installable artifact.
await verifyCapabilityFiles(runtime,{...parsed,files:parsed.files.filter(x=>x.path!=='toolkit-manifest.json')});
const name=new URL(parsed.source.assetUrl).pathname.split('/').pop()!;
await mkdir(output,{recursive:true});await writeFile(join(output,name),entry.bundle!,{flag:'wx'});
const catalog={...entry,source:'github',bundle:undefined,url:parsed.source.assetUrl,manifestJson:JSON.parse(entry.bundle!).manifest,maxBundleBytes:256*1024*1024};
await writeFile(join(output,name+'.catalog.json'),JSON.stringify(catalog,null,2),{flag:'wx'});
await writeFile(join(output,name+'.sha256'),entry.bundleSha256+'  '+name+'\n',{flag:'wx'});
console.log(JSON.stringify({file:join(output,name),bytes:entry.bundleBytes,sha256:entry.bundleSha256,wechatVersion:record.wechatVersion,files:parsed.files.length}));
