import {app,safeStorage} from 'electron';
import {readFile,readdir,stat} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {z} from 'zod';
import {Store} from '../core/store';
import {OpenCodeExtension} from '../extensions/opencode/service';
import {TavilyExtension} from '../extensions/tavily/service';
import {DesktopLooks} from '../core/desktop-looks';
import {emptySharedAi} from '../shared/shared-ai';
import {browserLibrarySchema} from '../core/browser-library';

/** Read-only source reader. Its sole output is a private pipe consumed by the parent. */
export async function runSourceExport(){
 const index=process.argv.indexOf('--account-source-export');
 const [source,context,edition]=process.argv.slice(index+1,index+4);
 if(!source||!context||!isAbsolute(source)||!isAbsolute(context)||!['opensource','pro'].includes(edition)){app.exit(2);return;}
 app.setName(edition==='opensource'?'CShell':'CShell Pro');app.setPath('userData',context);app.setPath('sessionData',context);
 try{
  await app.whenReady();
  if(!safeStorage.isEncryptionAvailable()||(process.platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text'))throw Error();
  let bytesRead=0;
  const bounded=async(path:string)=>{const info=await stat(path);if(info.size>16*1024*1024||bytesRead+info.size>64*1024*1024)throw Error();bytesRead+=info.size;return readFile(path);};
  const codec={encrypt:async(value:string)=>(await safeStorage.encryptStringAsync(value)).toString('base64'),decrypt:async(value:string)=>(await safeStorage.decryptStringAsync(Buffer.from(value,'base64'))).result};
  const encrypted=async(name:string,fallback:unknown)=>{try{return JSON.parse(await codec.decrypt((await bounded(join(source,name))).toString('utf8')));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw error;}};
  // Store and extension readers use their original schemas and do not save during load/export.
  await bounded(join(source,'config.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});
  const store=new Store(source,codec);await store.load();const configuration=await store.cloudExport();
  const desktopRaw=await encrypted('desktop-looks.enc',undefined);
  const desktopLooks=desktopRaw===undefined?undefined:new DesktopLooks(source,store).cloudValidate(desktopRaw);
  const rawAi=await encrypted('ai.enc',emptySharedAi());
  const ai={...(rawAi.policy?{policy:rawAi.policy}:{}),providers:rawAi.providers??[],habits:rawAi.habits??[],extractionProviderId:rawAi.extractionProviderId??null,textProviderIds:rawAi.textProviderIds??{translate:null,compose:null}};
  const extension=new OpenCodeExtension({directory:join(source,'extensions','opencode'),enabled:()=>false,...codec,saveProvider:async()=>{},open:async()=>{}});
  await bounded(join(source,'extensions','opencode','opencode.enc')).catch(error=>{if(error.code!=='ENOENT')throw error;});
  await extension.load();
  const tavily=new TavilyExtension({directory:join(source,'extensions','tavily'),enabled:()=>false,...codec});
  await bounded(join(source,'extensions','tavily','tavily.enc')).catch(error=>{if(error.code!=='ENOENT')throw error;});
  await tavily.load();
  const devices=await encrypted(join('client-controller','devices.enc'),[]);
  const http=(await encrypted('http.enc',{workspaces:[]})).workspaces;
  const browser:Record<string,unknown>={};
  const names=await readdir(join(source,'machine-browser')).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  for(const name of names)if(/^[a-f0-9]{64}\.bin$/.test(name))browser[name.slice(0,-4)]=browserLibrarySchema.parse(JSON.parse(safeStorage.decryptString(await bounded(join(source,'machine-browser',name)))));
  const assets:Record<string,string>={};
  for(const preferences of [configuration.preferences,...configuration.presets.map(p=>p.preferences)]){
   for(const asset of [preferences.backgroundAsset,preferences.uiFontAsset,preferences.terminalFontAsset]){
    if(!asset||assets[asset.id])continue;z.string().regex(/^[a-f0-9]{64}\.(ttf|otf|woff|woff2|png)$/).parse(asset.id);
    const value=await bounded(join(source,'appearance',asset.id));if(value.length>8*1024*1024)throw Error();assets[asset.id]=value.toString('base64');
   }
  }
  const result=JSON.stringify({format:1,store:configuration,ai,opencode:await extension.cloudExport(),tavily:await tavily.cloudExport(),...(desktopLooks===undefined?{}:{desktopLooks}),devices,http,browser,assets});
  if(Buffer.byteLength(result)>90*1024*1024)throw Error();
  await new Promise<void>((resolve,reject)=>process.stdout.write('CSHELL_SOURCE_V1\n'+result,error=>error?reject(error):resolve()));
  app.quit();
 }catch{process.stderr.write('无法读取来源配置，原文件未修改。');app.exit(1);}
}
