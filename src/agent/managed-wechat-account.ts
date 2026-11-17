import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { win32 } from 'node:path';

// Restart Manager compares the PID and the process FILETIME of an actual holder.
// Reading lock ownership does not require reading any account database contents.
const discover = String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AccountFileOwner {
    [StructLayout(LayoutKind.Sequential)] struct Owner {
        public int Pid;
        public System.Runtime.InteropServices.ComTypes.FILETIME Birth;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct ProcessInfo {
        public Owner Owner;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string Name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string Service;
        public uint Type, Status, Session;
        [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
    }
    [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)]
    static extern int RmStartSession(out uint handle,int flags,string key);
    [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)]
    static extern int RmRegisterResources(uint handle,uint count,string[] files,uint procs,IntPtr p,uint svcs,IntPtr s);
    [DllImport("rstrtmgr.dll")]
    static extern int RmGetList(uint handle,out uint need,ref uint count,[In,Out] ProcessInfo[] result,ref uint why);
    [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint handle);
    public static bool Matches(int pid,long birth,string[] files) {
        uint handle;
        if (files.Length == 0) return false;
        if (RmStartSession(out handle,0,Guid.NewGuid().ToString("N")) != 0) throw new InvalidOperationException();
        try {
            if (RmRegisterResources(handle,(uint)files.Length,files,0,IntPtr.Zero,0,IntPtr.Zero) != 0) throw new InvalidOperationException();
            uint need,count=0,why=0;
            int status=RmGetList(handle,out need,ref count,null,ref why);
            if (status == 0 && need == 0) return false;
            if (status != 234 || need > 1024) throw new InvalidOperationException();
            var owners=new ProcessInfo[need];
            count=need;
            if (RmGetList(handle,out need,ref count,owners,ref why) != 0) throw new InvalidOperationException();
            for(int i=0;i<count;i++) {
                var owner=owners[i].Owner;
                long started=((long)owner.Birth.dwHighDateTime << 32) | (uint)owner.Birth.dwLowDateTime;
                if(owner.Pid==pid && started==birth) return true;
            }
            return false;
        } finally { RmEndSession(handle); }
    }
}
"@
$root=Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'xwechat_files'
if (!(Test-Path -LiteralPath $root -PathType Container)) { return }
foreach($dir in (Get-ChildItem -LiteralPath $root -Directory)) {
    if ($dir.Name -notmatch '^(wxid_[A-Za-z0-9_]{3,64})_[a-fA-F0-9]{4}$' -or ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint)) { continue }
    $id=$Matches[1]
    $data=Join-Path $dir.FullName 'db_storage'
    if (!(Test-Path -LiteralPath $data -PathType Container)) { continue }
    $files=@(Get-ChildItem -LiteralPath $data -Filter '*.db*' -File -Recurse | Select-Object -First 120 -ExpandProperty FullName)
    if ([AccountFileOwner]::Matches([int]$env:CAGENT_WECHAT_PID,[long]$env:CAGENT_WECHAT_BIRTH,[string[]]$files)) { $id }
}`;

export async function detectWechatAccount(snapshot: unknown) {
  const list = (snapshot as {processes?: {pid:number; creationTime:string}[]})?.processes;
  if (process.platform !== 'win32' || !Array.isArray(list) || list.length !== 1 ||
      !Number.isSafeInteger(list[0].pid) || list[0].pid <= 0 || !/^\d{1,19}$/.test(list[0].creationTime)) {
    throw Error('请打开对应版本微信并登录，再识别当前账号。');
  }
  const shell = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  let stdout: string;
  try {
    ({stdout} = await promisify(execFile)(shell, ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(discover,'utf16le').toString('base64')], {
      windowsHide:true, timeout:20000, maxBuffer:32768,
      env:{...process.env,CAGENT_WECHAT_PID:String(list[0].pid),CAGENT_WECHAT_BIRTH:list[0].creationTime},
    }));
  } catch { throw Error('无法核验微信当前使用的账号目录。可输入内部账号 ID。'); }
  const unique = [...new Set(stdout.trim().split(/\s+/))];
  if (unique.length !== 1 || !/^wxid_[A-Za-z0-9_]{3,64}$/.test(unique[0])) {
    throw Error('未识别到唯一账号。请核对微信数据目录，或填写内部账号 ID。');
  }
  return {accountId: unique[0]};
}
