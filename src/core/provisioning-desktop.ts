import {mkdir,mkdtemp,readdir,lstat,link,rm} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {Store} from './store';
import {deploymentFile,deploymentPackages,initialDesktopPlugins} from './provisioning';
import {customExtensionRoot,installCustomExtension} from './custom-extensions';
const runtimeFiles=new Set(['Cache','Code Cache','GPUCache','GPUPersistentCache','ShaderCache','DawnGraphiteCache','DawnWebGPUCache','Crashpad','Dictionaries','Local State','Network','Preferences','Session Storage','blob_storage','logs','SingletonLock','SingletonCookie','SingletonSocket','First Run','BrowserMetrics','BrowserMetrics-spare.pma','lockfile']);
async function existing(path:string){try{await lstat(path);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}
export async function provisionDesktop(file:string,directory:string,apply=false){
 const input=await deploymentFile(file);if(input.config.target!=='cshell')throw Error('请选择 CShell 部署配置');
 const target=resolve(directory);
 const names=await readdir(target).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
 if(names.some(name=>!runtimeFiles.has(name)))return {applied:false,existingDataPreserved:true,reason:'已有应用数据，未覆盖账号、扩展或权限'};
 const plugins=initialDesktopPlugins(input.config),packs=await deploymentPackages(input);
 const ids=new Set(plugins.map(p=>p.manifest.id));
 for(const pack of packs){if(ids.has(pack.value.manifest.id))throw Error('部署扩展身份重复');ids.add(pack.value.manifest.id);if(await existing(join(customExtensionRoot(),pack.value.manifest.id)))throw Error('本机已存在该自定义扩展，初始部署不会覆盖');plugins.push({manifest:pack.value.manifest,enabled:false,source:'deployment:'+pack.sha256});}
 const plan={extensions:plugins.map(p=>({id:p.manifest.id,enabled:p.enabled})),screenSharingStarted:false,capabilityExecutionGranted:false};
 if(!apply)return {applied:false,plan};
 for(let path=target;;path=dirname(path)){if(await existing(path)&&(await lstat(path)).isSymbolicLink())throw Error('部署数据目录不能经过链接');if(dirname(path)===path)break;}
 await mkdir(dirname(target),{recursive:true});const stage=await mkdtemp(join(dirname(target),'.cshell-provision-'));
 try{const store=new Store(stage,{encrypt:async()=>{throw Error('初始扩展部署不处理凭据');},decrypt:async()=>{throw Error('初始扩展部署不读取凭据');}});await store.load();await store.setPlugins(plugins);await mkdir(target,{recursive:true});await link(join(stage,'config.json'),join(target,'config.json'));}
 finally{await rm(stage,{recursive:true,force:true});}
 try{for(const pack of packs)await installCustomExtension(pack);}catch{throw Error('扩展选择已保存，但自定义包导入失败；已有数据保留，请单独重新导入包');}
 return {applied:true,plan};
}
