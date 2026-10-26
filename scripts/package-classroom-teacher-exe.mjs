import {createRequire} from 'node:module';import{resolve,join}from'node:path';import{readFile,writeFile}from'node:fs/promises';import{spawnSync}from'node:child_process';import{createHash}from'node:crypto';
const require=createRequire(import.meta.url),builder=createRequire(require.resolve('electron-builder')),{getMakeNsisPath}=builder('app-builder-lib/out/toolsets/windows');
if(!process.argv[2]||!process.argv[3])throw Error('Usage: bundle-directory output.exe');
const input=resolve(process.argv[2]),output=resolve(process.argv[3]),manifest=JSON.parse(await readFile(join(input,'teacher-deployment.json'),'utf8'));
if(manifest.format!=='cshell-teacher-bundle-1'||manifest.productName!=='CShell'||!/^\d+\.\d+\.\d+$/.test(manifest.version))throw Error('Expected verified Core teacher bundle');
for(const entry of [manifest.installer,manifest.script,manifest.config]){if(!/^[\w .-]+$/.test(entry.file))throw Error('Invalid filename');if(createHash('sha256').update(await readFile(join(input,entry.file))).digest('hex')!==entry.sha256)throw Error('Payload hash mismatch');}
const quote=s=>s.replaceAll('$','$$').replaceAll('"','$\\"');
const names=['teacher-deployment.json','Install-ClassroomTeacher.ps1',manifest.installer.file,manifest.script.file,manifest.config.file];
const source=`Unicode true
!include "MUI2.nsh"
Name "CShell 机房教师端"
OutFile "${quote(output)}"
Icon "${quote(resolve('assets/icon.ico'))}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\\Programs\\CShell"
SetCompress off
VIProductVersion "${manifest.version}.0"
VIAddVersionKey "ProductName" "CShell Classroom Teacher"
VIAddVersionKey "FileDescription" "Classroom teacher screen-sharing fix 1"
VIAddVersionKey "FileVersion" "${manifest.version}"
VIAddVersionKey "LegalCopyright" "MIT - CShell contributors"
!define MUI_WELCOMEPAGE_TEXT "安装或更新教师端。请先正常退出 CShell，已有连接与配置会保留。$\\r$\\n$\\r$\\n本次修复屏幕选择、共享名称及发现启动失败后的重试。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\\CShell.exe"
!define MUI_FINISHPAGE_RUN_TEXT "打开 CShell"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"
Section "Install"
 InitPluginsDir
 SetOutPath "$PLUGINSDIR\\teacher"
${names.map(n=>' File "'+quote(join(input,n))+'"').join('\n')}
 System::Call 'Kernel32::SetEnvironmentVariable(t "PSModulePath", t "")'
 nsExec::ExecToLog '"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\\teacher\\Install-ClassroomTeacher.ps1" -CShellDestination "$INSTDIR" -Apply'
 Pop $0
 StrCmp $0 "0" success
 SetErrorLevel 1
 Abort "安装未完成，请查看详情。不会强制结束正在使用的会话。"
 success:
 SetErrorLevel 0
SectionEnd
`;
const nsi=resolve('.local/classroom-teacher-installer.nsi');await writeFile(nsi,'\uFEFF'+source);
const tool=await getMakeNsisPath(),r=spawnSync(tool.path,['/V2',nsi],{env:{...process.env,...tool.env},stdio:'inherit',windowsHide:true});if(r.error||r.status!==0)throw r.error??Error('NSIS build failed');
const b=await readFile(output);console.log(JSON.stringify({file:output,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')}));
