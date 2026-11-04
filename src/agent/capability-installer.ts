import { mkdir, mkdtemp, rm, writeFile, realpath } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { z } from 'zod';
import { updateRequest } from './update-request';
import { capabilityDigest, type CapabilityCatalogEntry } from './capability-catalog';
import { parseCapabilityManifest, verifyCapabilityFiles } from './capability-packages';

const bundleSchema=z.object({protocol:z.literal(1),manifest:z.string().max(1024*1024),files:z.record(z.string(),z.string())}).strict();
export const capabilityInstallInput=z.object({id:z.string().min(1).max(100),confirm:z.literal(true)}).strict();
/** Only caller-selected trusted catalog entries. No arbitrary URLs, scripts, archives or decompression. */
export function capabilityDownloadTimeout(bytes:number){return Math.min(600000,Math.max(120000,Math.ceil(bytes/(512*1024))*1000+120000));}
/** Linear scan avoids regexp backtracking stacks for native runtime binaries. */
export function validCapabilityBase64(value:string){
  if(value.length%4)return false;
  const padding=value.endsWith('==')?2:value.endsWith('=')?1:0;
  for(let i=0;i<value.length-padding;i++){
    const c=value.charCodeAt(i);
    if(!(c>=65&&c<=90||c>=97&&c<=122||c>=48&&c<=57||c===43||c===47))return false;
  }
  return true;
}
export async function stageCapabilityBundle(root:string,entry:CapabilityCatalogEntry,signal:AbortSignal,fetcher?:typeof fetch){
  signal.throwIfAborted();
  const budget=entry.maxBundleBytes??64*1024*1024;
  if(!Number.isSafeInteger(budget)||budget<1||budget>256*1024*1024||!Number.isSafeInteger(entry.bundleBytes)||entry.bundleBytes<1||entry.bundleBytes>budget)throw new Error('Package exceeds download budget');
  signal=AbortSignal.any([signal,AbortSignal.timeout(capabilityDownloadTimeout(entry.bundleBytes))]);
  const download=fetcher??((async(url,init)=>updateRequest(String(url),{signal:init!.signal!})) as typeof fetch);
  let bytes:Buffer;
  if(entry.source==='bundled'){
    if(entry.bundle===undefined)throw new Error('Bundled package missing');bytes=Buffer.from(entry.bundle);
  }else{
    const url=new URL(entry.url??'');
    if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.search||url.hash||!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/download\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(url.pathname))throw new Error('Expected trusted GitHub release asset');
    // GitHub's signed asset redirect is explicitly constrained; credentials are never forwarded.
    let response=await download(url,{signal,redirect:'manual'});
    if([301,302,303,307,308].includes(response.status)){
      const next=new URL(response.headers.get('location')??'',url);await response.body?.cancel();
      if(next.protocol!=='https:'||next.hostname!=='release-assets.githubusercontent.com'||next.username||next.password)throw new Error('Unexpected GitHub asset redirect');
      response=await download(next,{signal,redirect:'error'});
    }
    if(!response.ok||!response.body)throw new Error(`Package download failed: ${response.status}`);
    const length=response.headers.get('content-length');if(length&&Number(length)!==entry.bundleBytes){await response.body.cancel();throw new Error('Package download size mismatch');}
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    const cancel=()=>{void reader.cancel(signal.reason).catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
    try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;size+=value.byteLength;if(size>entry.bundleBytes)throw new Error('Package download exceeds declared size');chunks.push(value);}bytes=Buffer.concat(chunks);}
    catch(error){await reader.cancel().catch(()=>{});throw error;}finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
  }
  if(bytes.byteLength!==entry.bundleBytes||capabilityDigest(bytes)!==entry.bundleSha256)throw new Error('Package bundle digest or size mismatch');
  const bundle=bundleSchema.parse(JSON.parse(bytes.toString('utf8'))),manifest=parseCapabilityManifest(bundle.manifest,entry.manifestSha256);
  if(manifest.id!==entry.id||manifest.version!==entry.version)throw new Error('Package catalog identity mismatch');
  if(entry.source==='github'&&entry.url!==manifest.source.assetUrl)throw new Error('Package source does not match catalog');
  const paths=Object.keys(bundle.files);
  if(paths.length!==manifest.files.length||paths.some(path=>!manifest.files.some(file=>file.path===path)))throw new Error('Unexpected package file');
  const materialized=manifest.files.map(file=>{
    const base64=bundle.files[file.path];
    if(!validCapabilityBase64(base64))throw new Error('Invalid package file encoding');
    const content=Buffer.from(base64,'base64');if(content.length!==file.bytes||capabilityDigest(content)!==file.sha256)throw new Error('Package file digest mismatch');return {path:file.path,content};
  });
  await mkdir(root,{recursive:true});const canonical=await realpath(root),destination=await mkdtemp(join(canonical,'package-'));
  try{
    for(const file of materialized){signal.throwIfAborted();const path=join(destination,file.path),within=relative(destination,path);if(within.startsWith('..')||isAbsolute(within))throw new Error('Package path escape');await mkdir(dirname(path),{recursive:true});await writeFile(path,file.content,{flag:'wx',mode:0o600});}
    await verifyCapabilityFiles(destination,manifest);signal.throwIfAborted();
    return {root:destination,manifestJson:bundle.manifest,manifestSha256:entry.manifestSha256};
  }catch(error){await rm(destination,{recursive:true,force:true});throw error;}
}
