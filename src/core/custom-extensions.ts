import { createHash, verify, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm, stat, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { pluginManifestSchema } from '../shared/plugins';
import { customExtensionKey } from '../shared/custom-extension-key';
import { createBundledCapabilityEntry } from '../agent/capability-catalog';
import { ProcessCapabilityAdapter } from '../agent/process-capability';
import { verifyCapabilityFiles } from '../agent/capability-packages';

const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const pathSchema = z.string().max(240).refine(value => /^[A-Za-z0-9_. /-]+$/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part)));
const packageSchema = z.object({format:z.literal('cshell-extension-1'),manifest:pluginManifestSchema,
  files:z.array(z.object({path:pathSchema,sha256:z.string().regex(/^[a-f0-9]{64}$/),data:z.string()}).strict()).max(4096),
  signature:z.string().max(200).optional()}).strict();
export const customExtensionRoot = () => join(process.env.LOCALAPPDATA || join(homedir(),'.local','share'),'CShell','custom-extensions');
export function parseCustomExtension(text:string){
  if(Buffer.byteLength(text)>256*1024*1024)throw new Error('扩展包超过 256 MB');
  const value=packageSchema.parse(JSON.parse(text));
  const files=new Map<string,Buffer>();let total=0;
  for(const file of value.files){
    if(files.has(file.path.toLowerCase()))throw new Error('扩展包包含重复文件');
    const bytes=Buffer.from(file.data,'base64');total+=bytes.length;
    if(bytes.toString('base64')!==file.data)throw new Error('文件编码无效');
    if(total>192*1024*1024||digest(bytes)!==file.sha256)throw new Error('扩展文件摘要不匹配或体积过大');
    files.set(file.path.toLowerCase(),bytes);
  }
  const signed=JSON.stringify({format:value.format,manifest:value.manifest,files:value.files.map(({path,sha256})=>({path,sha256}))});
  const trusted=!!value.signature&&verify(null,Buffer.from(signed),customExtensionKey,Buffer.from(value.signature,'base64'));
  if(value.manifest.provider==='wechat'){
    if(!trusted||value.manifest.id!=='cshell.wechat'||!files.has('adapter.cjs')||!files.has('runtime/python.exe'))throw new Error('微信扩展需要完整且签名有效的独立安装包');
  }else if(value.manifest.provider==='process'){
    const capability=value.manifest.capability;
    if(value.manifest.id.startsWith('cshell.')||value.manifest.id.startsWith('cagent.')||!capability?.process||capability.id!==value.manifest.id||capability.adapterId!==value.manifest.id||capability.version!==value.manifest.version||value.manifest.commands.length||value.manifest.permissions.length!==1||value.manifest.permissions[0]!=='remote.execute')throw new Error('独立进程扩展清单不匹配');
    if(value.signature&&!trusted)throw new Error('扩展签名无效');
    if(total>16*1024*1024||Buffer.byteLength(JSON.stringify(capability))>1024*1024||capability.files.length!==value.files.length)throw new Error('独立进程扩展文件过大或不匹配');
    for(const file of capability.files){const item=value.files.find(item=>item.path===file.path),bytes=files.get(file.path.toLowerCase());if(!item||!bytes||item.sha256!==file.sha256||bytes.length!==file.bytes)throw new Error('能力清单文件摘要不匹配');}
  }else if(value.manifest.provider!=='snippets'||value.manifest.capability||value.manifest.id.startsWith('cshell.')||value.files.length||value.manifest.permissions.some(p=>p!=='terminal.input'))throw new Error('此扩展类型尚不支持外部加载');
  return {value,trusted,bytes:total,sha256:digest(text)};
}
/** Reads declarations and verifies bytes only. No extension code executes during discovery. */
export async function loadProcessExtensions(root=customExtensionRoot(), onInvalid?: (id: string) => void) {
  let directories;try{directories=await readdir(root,{withFileTypes:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  const result=[];
  for(const directory of directories){
    if(!directory.isDirectory()||directory.isSymbolicLink()||!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(directory.name)||directory.name.startsWith('cshell.')||directory.name.startsWith('cagent.'))continue;
    try {
    const base=join(root,directory.name),pointer=join(base,'current.json');
    let current;try{if((await lstat(pointer)).isSymbolicLink())throw new Error('Extension pointer cannot be a symlink');current=JSON.parse(await readFile(pointer,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
    const installed=join(base,z.string().uuid().parse(current.directory));
    if((await lstat(installed)).isSymbolicLink()||(await lstat(join(installed,'package.cshellext'))).isSymbolicLink())throw new Error('Extension package cannot be a symlink');
    const pack=await readCustomExtension(join(installed,'package.cshellext'));
    if(pack.value.manifest.provider!=='process')continue;
    const manifest=pack.value.manifest.capability!;
    if(manifest.id!==directory.name)throw new Error('Installed extension identity mismatch');
    await verifyCapabilityFiles(installed,manifest);
    result.push({entry:createBundledCapabilityEntry(manifest,Object.fromEntries(pack.value.files.map(file=>[file.path,Buffer.from(file.data,'base64')]))),adapter:new ProcessCapabilityAdapter(manifest),manifest:pack.value.manifest,digest:pack.sha256,installToken:current.directory as string});
    } catch { onInvalid?.(directory.name); }
  }
  return result;
}
export async function readCustomExtension(path:string){
  if(!path.toLowerCase().endsWith('.cshellext'))throw new Error('请选择 .cshellext 扩展包');
  const info=await stat(path);if(!info.isFile()||info.size>256*1024*1024)throw new Error('扩展文件无效或超过 256 MB');
  const bytes=await readFile(path);
  return parseCustomExtension((bytes[0]===0x1f&&bytes[1]===0x8b?gunzipSync(bytes,{maxOutputLength:256*1024*1024}):bytes).toString('utf8'));
}
export async function installCustomExtension(pack:ReturnType<typeof parseCustomExtension>,root=customExtensionRoot()){
  // Revalidate at the trust boundary; callers cannot forge the parsed object.
  const checked=parseCustomExtension(JSON.stringify(pack.value));
  if(checked.value.manifest.provider==='wechat'&&(process.platform!=='win32'||process.arch!=='x64'))throw new Error('此微信扩展仅适用于 Windows x64');
  const base=join(root,checked.value.manifest.id);await mkdir(base,{recursive:true});
  const stage=join(base,randomUUID());await mkdir(stage);
  try{
    for(const file of checked.value.files){const path=join(stage,...file.path.split('/'));await mkdir(join(path,'..'),{recursive:true});await writeFile(path,Buffer.from(file.data,'base64'),{flag:'wx'});}
    await writeFile(join(stage,'package.cshellext'),JSON.stringify(checked.value));
    const pointer=join(base,'current.'+randomUUID()+'.tmp');await writeFile(pointer,JSON.stringify({directory:stage.split(/[\\/]/).at(-1)}));await rename(pointer,join(base,'current.json'));
    return checked.value.manifest;
  }catch(error){await rm(stage,{recursive:true,force:true});throw error;}
}
export async function loadPrivateWechat(root=customExtensionRoot()):Promise<{module: typeof import('../extensions/wechat/entry');runtime:string}|undefined>{
  if(process.platform!=='win32'||process.arch!=='x64')return;
  const base=join(root,'cshell.wechat');let pointer;
  try{pointer=JSON.parse(await readFile(join(base,'current.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  const name=z.string().uuid().parse(pointer.directory),directory=join(base,name);
  const pack=await readCustomExtension(join(directory,'package.cshellext'));
  if(pack.value.manifest.id!=='cshell.wechat')throw new Error('扩展身份不匹配');
  for(const file of pack.value.files)if(digest(await readFile(join(directory,...file.path.split('/'))))!==file.sha256)throw new Error('已安装扩展文件被修改，请重新导入');
  const require=createRequire(join(directory,'loader.cjs'));
  return {module:require(join(directory,'adapter.cjs')),runtime:join(directory,'runtime')};
}
