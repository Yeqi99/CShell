import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url),builder=createRequire(require.resolve('electron-builder'));
const {getMakeNsisPath}=builder('app-builder-lib/out/toolsets/windows');
const input=resolve(process.argv[2]),output=resolve(process.argv[3]);
const manifest=JSON.parse(await readFile(join(input,'deployment.json'),'utf8'));
if(manifest.platform!=='win32'||manifest.arch!=='x64'||!/^\d+\.\d+\.\d+$/.test(manifest.version))throw Error('Expected Windows deployment');
const quote=s=>s.replaceAll('$','$$').replaceAll('"','$\\"');
const source=`Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
Name "CAgent"
Icon "${quote(resolve('assets/cagent-icon.ico'))}"
OutFile "${quote(output)}"
InstallDir "$LOCALAPPDATA\\Programs\\CAgent"
RequestExecutionLevel user
SetCompressor /SOLID lzma
VIProductVersion "${manifest.version}.0"
VIAddVersionKey "ProductName" "CAgent"
VIAddVersionKey "FileDescription" "CAgent Installer"
VIAddVersionKey "FileVersion" "${manifest.version}"
VIAddVersionKey "LegalCopyright" "MIT - CAgent contributors"
!define VERSION "${manifest.version}"
!define PRODUCT_NAME "CAgent"
!define CAGENT_INSTALLER
!include "${quote(resolve('scripts/windows-deployment/installer-update-page.nsh'))}"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom ShowInstallSummary
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TEXT "CAgent 已安装。若旧版正在运行，请正常退出后从开始菜单打开新版。远程桌面组件已随程序提供，访问权限需在应用内配置。"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"
Function .onInit
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=Find-CAgent.ps1 "${quote(resolve('scripts/windows-deployment/Find-CAgent.ps1'))}"
  \${GetParameters} $0
  ClearErrors
  \${GetOptions} $0 "/D=" $1
  IfErrors 0 done
  StrCmp $INSTDIR "$LOCALAPPDATA\\Programs\\CAgent" 0 done
  nsExec::ExecToStack '\"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe\" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"$PLUGINSDIR\\Find-CAgent.ps1\"'
  Pop $0
  Pop $1
  StrCmp $0 "0" 0 done
  StrCmp $1 "" done
  StrCpy $INSTDIR $1
  done:
FunctionEnd
Section "Install"
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\\deployment"
  File /r "${quote(input)}\\*"
  System::Call 'Kernel32::SetEnvironmentVariable(t "PSModulePath", t "")'
  StrCpy $1 ""
  IfSilent 0 +2
    StrCpy $1 "-NoLaunch -NoShortcuts -RefreshExistingShortcuts"
  \${GetParameters} $2
  ClearErrors
  \${GetOptions} $2 "/RESTART" $3
  IfErrors +2 0
    StrCpy $1 "-NoShortcuts -RefreshExistingShortcuts"
  ClearErrors
  \${GetOptions} $2 "/PREPARE" $3
  IfErrors +2 0
    StrCpy $1 "-NoLaunch -NoShortcuts -PrepareOnly"
  nsExec::ExecToLog '\"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe\" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"$PLUGINSDIR\\deployment\\Install-CAgent.ps1\" -Destination \"$INSTDIR\" $1'
  Pop $0
  StrCmp $0 "0" success
    SetErrorLevel 1
    Abort "CAgent 安装失败，请查看安装详情。"
  success:
  SetErrorLevel 0
SectionEnd
`;
const script=join(input,'..','cagent-installer.nsi');await writeFile(script,'\uFEFF'+source,'utf8');
const tool=await getMakeNsisPath();const result=spawnSync(tool.path,['/V2',script],{env:{...process.env,...tool.env},stdio:'inherit',windowsHide:true});
if(result.error||result.status!==0)throw result.error??Error('NSIS compilation failed');
console.log(output);

