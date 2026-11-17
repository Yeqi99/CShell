import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';

const candidates=['config.json','desktop-looks.enc','ai.enc','opencode.enc','extensions/opencode/opencode.enc','extensions/tavily/tavily.enc','http.enc','client-controller/devices.enc','machine-browser'];

/** Discovery returns presence only. Preview and import still validate the entire source in its encryption context. */
export async function hasAccountSource(directory:string,probe:()=>Promise<unknown>):Promise<boolean>{
 for(const file of candidates){
  const path=join(directory,file);
  try{
   const info=await stat(path);
   if(file==='config.json' && info.isFile() && info.size<=16*1024*1024){
    const config=JSON.parse(await readFile(path,'utf8'));
    if(config?.version===1 && ['profiles','groups','presets','monitorViews'].some(field=>Array.isArray(config[field])&&config[field].length>0))return true;
   }
  }catch(error){
   if((error as NodeJS.ErrnoException).code==='ENOENT')continue;
   throw error;
  }
  return await probe()===true;
 }
 return false;
}
