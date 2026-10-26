import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url),builder=createRequire(require.resolve('electron-builder'));
const {getMakeNsisPath}=builder('app-builder-lib/out/toolsets/windows');
if(!process.argv[2])throw Error('Specify a new output EXE path');
const output=resolve(process.argv[2]);
const payload=resolve('.local/student-dl-exe-payload');await mkdir(payload,{recursive:true});
const files=[['release/0.8.11/CShell-Classroom-0.8.11-win-x64.zip','CShell-Classroom-0.8.11-win-x64.zip','549e84dabfef5021d3088a70b4729efca70ddc4c9cec7eac25cc3a85ac32db9d'],['scripts/classroom/Install-DL-Lab.ps1','Install-DL-Lab-1.ps1','cc0d1db8d613a3506c5e5f5e336e73d2a714a4185d078a8b37907fa126f16793'],['scripts/classroom/Install-Student-DL.ps1','Install-Student-DL.ps1',null]];
const digest=b=>createHash('sha256').update(b).digest('hex');
for(const [src,name,expected]of files){if(expected&&digest(await readFile(src))!==expected)throw Error('Unexpected payload '+name);await copyFile(src,join(payload,name));}
const quote=s=>s.replaceAll('$','$$').replaceAll('"','$\\"');
const source=`Unicode true
!include "MUI2.nsh"
Name "CShell 学生机 + dl 教学环境"
OutFile "${quote(output)}"
Icon "${quote(resolve('assets/cagent-icon.ico'))}"
InstallDir "$PROFILE\\CShell-DL-Lab"
RequestExecutionLevel user
SetCompress off
VIProductVersion "0.8.11.0"
VIAddVersionKey "ProductName" "CShell Classroom Student DL"
VIAddVersionKey "FileDescription" "CShell student and dl environment setup"
VIAddVersionKey "FileVersion" "0.8.11"
VIAddVersionKey "LegalCopyright" "MIT - CShell contributors"
!define MUI_WELCOMEPAGE_TITLE "安装学生机与 dl 环境"
!define MUI_WELCOMEPAGE_TEXT "安装 CShell、CAgent 与独立 dl 环境：Python 3.10、TensorFlow 2.15.1 CPU、Jupyter、pandas、NumPy、Matplotlib。$\\r$\\n$\\r$\\n请使用学生的 Windows 账号，先正常退出 CShell。需要联网下载环境依赖，目标磁盘至少 22 GiB 空闲。$\\r$\\n$\\r$\\n新安装的 CAgent 启用机房发现与登录自启，初始密码 123456。保留已有身份、密码和权限。"
!define MUI_DIRECTORYPAGE_TEXT_TOP "选择 dl 环境专用目录。CShell 与 CAgent 安装到当前用户的应用目录；不覆盖已有 Python/base 环境。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TEXT "安装及环境检查已完成。桌面提供 dl CMD 与 dl Jupyter 快捷方式。教师机可发现并配对 CAgent。"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"
Section "Install"
 InitPluginsDir
 SetOutPath "$PLUGINSDIR\\student-dl"
 File "${quote(join(payload,'CShell-Classroom-0.8.11-win-x64.zip'))}"
 File "${quote(join(payload,'Install-DL-Lab-1.ps1'))}"
 File "${quote(join(payload,'Install-Student-DL.ps1'))}"
 System::Call 'Kernel32::SetEnvironmentVariable(t "PSModulePath", t "")'
 nsExec::ExecToLog '"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\\student-dl\\Install-Student-DL.ps1" -Root "$INSTDIR"'
 Pop $0
 StrCmp $0 "0" success
 SetErrorLevel 1
 Abort "安装未完成，请查看详情及 LOCALAPPDATA 下 CShell-ClassroomSetup 的日志。不要盲目重复安装。"
 success:
 SetErrorLevel 0
SectionEnd
`;
const nsi=resolve('.local/student-dl-installer.nsi');await writeFile(nsi,'\uFEFF'+source);
const tool=await getMakeNsisPath();const result=spawnSync(tool.path,['/V2',nsi],{env:{...process.env,...tool.env},stdio:'inherit',windowsHide:true});
if(result.error||result.status!==0)throw result.error??Error('NSIS failed');
const bytes=await readFile(output);console.log(JSON.stringify({file:output,bytes:bytes.length,sha256:digest(bytes)}));
