import {readFile} from 'node:fs/promises';
import {win32} from 'node:path';

export function installedRuntimeConflict(entry:string,launcher:string):boolean {
 const current=win32.dirname(win32.resolve(entry));
 if(win32.basename(win32.dirname(current)).toLowerCase()!=='versions')return false;
 const root=win32.dirname(win32.dirname(current));
 // Match only the installer-generated quoted executable, never execute VBS.
 const match=/sh\.Run Chr\(34\) & "([^"\r\n]+\\Cagent\.exe)" & Chr\(34\)/i.exec(launcher);
 if(!match)return false;
 const selected=win32.dirname(win32.resolve(match[1]));
 if(win32.dirname(selected).toLowerCase()!==win32.join(root,'versions').toLowerCase())return false;
 return selected.toLowerCase()!==current.toLowerCase();
}
export async function assertCurrentInstalledRuntime(entry:string){
 if(process.platform!=='win32')return;
 const current=win32.dirname(win32.resolve(entry));
 if(win32.basename(win32.dirname(current)).toLowerCase()!=='versions')return;
 let text:string;
 try{text=(await readFile(win32.join(win32.dirname(win32.dirname(current)),'Open CAgent.vbs'))).toString('utf16le');}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
 if(installedRuntimeConflict(entry,text))throw Error('已安装新的 CAgent，请从现有快捷方式重新打开；旧窗口不会重新启动旧后台。');
}
