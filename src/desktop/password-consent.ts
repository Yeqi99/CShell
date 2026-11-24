import {execFile} from 'node:child_process';
import {join} from 'node:path';
import {promisify} from 'node:util';

// IUserConsentVerifierInterop binds the system prompt to the requesting desktop window.
const verifier = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class PasswordConsent {
    [DllImport("combase.dll", CharSet=CharSet.Unicode)] static extern int WindowsCreateString(string value, int length, out IntPtr handle);
    [DllImport("combase.dll")] static extern int WindowsDeleteString(IntPtr handle);
    [DllImport("combase.dll")] static extern int RoGetActivationFactory(IntPtr name, ref Guid iid, out IntPtr factory);
    delegate int Verify(IntPtr self, IntPtr hwnd, IntPtr prompt, ref Guid iid, out IntPtr operation);
    delegate int ReadInt(IntPtr self, out int value);
    static T Method<T>(IntPtr self, int slot) where T:class {
        return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(self),slot*IntPtr.Size),typeof(T));
    }
    static IntPtr Factory() {
        const string name = "Windows.Security.Credentials.UI.UserConsentVerifier";
        IntPtr h;
        Marshal.ThrowExceptionForHR(WindowsCreateString(name,name.Length,out h));
        try {
            IntPtr factory;
            var iid = new Guid("39E050C3-4E74-441A-8DC0-B81104DF949C");
            Marshal.ThrowExceptionForHR(RoGetActivationFactory(h, ref iid, out factory));
            return factory;
        } finally {WindowsDeleteString(h);}
    }
    public static bool Check(long hwnd) {
        var factory=Factory(); IntPtr msg=IntPtr.Zero, op=IntPtr.Zero, info=IntPtr.Zero;
        try {
            const string prompt="CShell · 查看此连接已保存的 SSH 密码";
            Marshal.ThrowExceptionForHR(WindowsCreateString(prompt,prompt.Length,out msg));
            var iid=new Guid("fd596ffd-2318-558f-9dbe-d21df43764a5");
            Marshal.ThrowExceptionForHR(Method<Verify>(factory,6)(factory,new IntPtr(hwnd),msg,ref iid,out op));
            var asyncInfo=new Guid("00000036-0000-0000-C000-000000000046");
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(op,ref asyncInfo,out info));
            int status, result;
            do {Marshal.ThrowExceptionForHR(Method<ReadInt>(info,7)(info,out status));if(status==0)Thread.Sleep(100);} while(status==0);
            return status==1 && Method<ReadInt>(op,8)(op,out result)==0 && result==0;
        } finally {
            if(info!=IntPtr.Zero)Marshal.Release(info);
            if(op!=IntPtr.Zero)Marshal.Release(op);
            WindowsDeleteString(msg);Marshal.Release(factory);
        }
    }
}
"@
$type=[Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]

if ([PasswordConsent]::Check([long]$env:CSHELL_OWNER_HWND)) { 'VERIFIED' }
`;

export async function verifyPasswordView(owner: Buffer) {
  const hwnd = owner.length === 8 ? owner.readBigUInt64LE() : BigInt(owner.readUInt32LE());
  const executable = join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const {stdout} = await promisify(execFile)(executable, ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(verifier,'utf16le').toString('base64')], {
    windowsHide:true,timeout:90000,env:{...process.env,CSHELL_OWNER_HWND:String(hwnd)},
  }).catch(() => ({stdout:''}));
  if (stdout.trim() !== 'VERIFIED') throw new Error('Windows 身份验证未完成。');
}
