import {access,writeFile,unlink,mkdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
const installation=()=>dirname(dirname(dirname(resolve(process.argv[1]??process.execPath))));
const startup=()=>join(process.env.APPDATA??'', 'Microsoft/Windows/Start Menu/Programs/Startup/CAgent.vbs');
export async function startupState(){
 const supported=process.platform==='win32'&&await access(join(installation(),'Open CAgent.vbs')).then(()=>true,()=>false);
 return {supported,enabled:supported&&await access(startup()).then(()=>true,()=>false)};
}
export async function setStartup(enabled:boolean){
 if(!(await startupState()).supported)throw new Error('当前运行目录不支持开机启动配置，请使用安装版');
 const file=startup(),marker=join(installation(),'autostart-disabled');
 if(enabled){await mkdir(dirname(file),{recursive:true});const launcher=join(installation(),'Open CAgent.vbs').replaceAll('"','""');await writeFile(file,'\uFEFF'+`Set sh = CreateObject("WScript.Shell")\r\nsh.Run Chr(34) & "${launcher}" & Chr(34), 0, False\r\n`,'utf16le');await unlink(marker).catch(e=>{if(e.code!=='ENOENT')throw e});}
 else{await unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e});await writeFile(marker,'disabled');}
 return startupState();
}
