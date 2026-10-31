!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
Var ExistingVersion
Var InstallAction
Var InstallSummary
Function ShowInstallSummary
  StrCpy $ExistingVersion ""
  !ifdef CAGENT_INSTALLER
    IfFileExists "$INSTDIR\Open CAgent.vbs" 0 fresh
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\Find-CAgent.ps1" -VersionOf "$INSTDIR"'
    Pop $0
    Pop $ExistingVersion
    StrCmp $0 "0" 0 unknown
    StrCmp $ExistingVersion "" 0 existing
    unknown:
    StrCpy $ExistingVersion "已安装版本（版本信息不可用）"
  !else
    IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 fresh
    ${GetFileVersion} "$INSTDIR\${APP_EXECUTABLE_FILENAME}" $ExistingVersion
  !endif
  existing:
  StrCpy $InstallAction "更新 / 修复"
  StrCpy $InstallSummary "当前版本：$ExistingVersion$\r$\n目标版本：${VERSION}$\r$\n$\r$\n沿用安装目录：$INSTDIR$\r$\n保留连接、分组、账号、凭据和访问权限。"
  Goto show
  fresh:
  StrCpy $InstallAction "安装"
  StrCpy $InstallSummary "版本：${VERSION}$\r$\n$\r$\n安装目录：$INSTDIR"
  show:
  !insertmacro MUI_HEADER_TEXT "$InstallAction ${PRODUCT_NAME}" "确认程序目录与版本"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 5u 100% 95u "$InstallSummary"
  Pop $0
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:$InstallAction"
  nsDialogs::Show
FunctionEnd
!ifndef CAGENT_INSTALLER
!macro customPageAfterChangeDir
  Page custom ShowInstallSummary
!macroend
!endif
