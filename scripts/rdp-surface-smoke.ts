import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {_electron} from 'playwright';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

if(process.platform!=='win32'){console.log('SKIP Windows native RDP surface');process.exit(0);}
const dir=await mkdtemp(join(tmpdir(),'cshell-rdp-surface-'));
// Exercise the actual HWND lifecycle without a network handshake blocking the STA.
// Only Connect() is substituted in this isolated bundle; production code and
// native smoke / real-target acceptance still exercise Microsoft authentication.
const source=await readFile('src/desktop/embedded-rdp.ts','utf8');
assert.equal(source.split('c.Connect();').length,2);
await build({stdin:{contents:source.replace('c.Connect();','/* network omitted in HWND-only fixture */'),loader:'ts',resolveDir:resolve('src/desktop')},outfile:join(dir,'service.cjs'),bundle:true,platform:'node',format:'cjs'});
await writeFile(join(dir,'main.cjs'),`const{app,BrowserWindow}=require(${JSON.stringify(requireResolveElectron())});globalThis.localRequire=require;app.setPath('userData',${JSON.stringify(join(dir,'data'))});app.whenReady();`);
function requireResolveElectron(){return 'electron';}
const probe=join(dir,'probe.ps1');
await writeFile(probe,`param([int]$TargetPid,[long]$ExpectedOwner)
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public class SurfaceProbe {
public delegate bool E(IntPtr h,IntPtr p);
[DllImport("user32.dll")]static extern bool EnumWindows(E f,IntPtr p);
[DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
[DllImport("user32.dll")]static extern int GetClassName(IntPtr h,StringBuilder s,int n);
[DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
[DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")]public static extern IntPtr GetWindow(IntPtr h,uint cmd);
[DllImport("user32.dll")]public static extern IntPtr GetAncestor(IntPtr h,uint flags);
public static string[] Describe(IntPtr h){uint pid;GetWindowThreadProcessId(h,out pid);var name=new StringBuilder(256);GetClassName(h,name,256);var title=new StringBuilder(256);GetWindowText(h,title,256);return new[]{h.ToString(),pid.ToString(),name.ToString(),title.ToString(),GetAncestor(h,3).ToString()};}
[DllImport("user32.dll")]static extern int GetWindowLong(IntPtr h,int n);
[DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr h,out Rect r);
[StructLayout(LayoutKind.Sequential)]public struct Rect{public int left,top,right,bottom;}
public static string Read(uint target){string result="null";EnumWindows((h,p)=>{uint pid;GetWindowThreadProcessId(h,out pid);var name=new StringBuilder(256);GetClassName(h,name,256);var title=new StringBuilder(256);GetWindowText(h,title,256);if(pid==target&&title.ToString()=="CShell RDP surface"&&name.ToString().StartsWith("WindowsForms10.Window.8.")){Rect r;GetWindowRect(h,out r);result="{\\"hwnd\\":\\""+h+"\\",\\"owner\\":\\""+GetWindow(h,4)+"\\",\\"visible\\":"+(IsWindowVisible(h)?"true":"false")+",\\"appWindow\\":"+((GetWindowLong(h,-20)&0x40000)!=0?"true":"false")+",\\"width\\":"+(r.right-r.left)+",\\"height\\":"+(r.bottom-r.top)+"}";return false;}return true;},IntPtr.Zero);return result;}
}
'@
$surface=[SurfaceProbe]::Read([uint32]$TargetPid)|ConvertFrom-Json
[ordered]@{surface=$surface;target=[SurfaceProbe]::Describe([IntPtr]$ExpectedOwner);actualOwner=$(if($surface){[SurfaceProbe]::Describe([IntPtr][long]$surface.owner)}else{$null});surfaceDetails=$(if($surface){[SurfaceProbe]::Describe([IntPtr][long]$surface.hwnd)}else{$null})}|ConvertTo-Json -Compress -Depth 5
`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({args:[join(dir,'main.cjs')],env});
try{
 const target=await app.evaluate(async({BrowserWindow},{modulePath,dir,port})=>{
  const win=new BrowserWindow({width:900,height:650,show:true,webPreferences:{sandbox:true}});await win.loadURL('data:text/html,<title>RDP lifecycle fixture</title>');
  const {EmbeddedRdpService}=(globalThis as any).localRequire(modulePath);const service=new EmbeddedRdpService(dir);
  const id='00000000-0000-4000-8000-000000000001';await service.open({id,name:'Fixture',protocol:'rdp',host:'127.0.0.1',port,username:'fixture',auth:'password',favorite:false,group:''},'',win.getNativeWindowHandle());
  (globalThis as any).fixture={win,service,id};const handle=win.getNativeWindowHandle();return {pid:service.sessions.get(id).child.pid,owner:(handle.length===8?handle.readBigUInt64LE():BigInt(handle.readUInt32LE())).toString()};
 },{modulePath:join(dir,'service.cjs'),dir,port:1});
 const read=()=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',probe,'-TargetPid',String(target.pid),'-ExpectedOwner',target.owner],{encoding:'utf8',windowsHide:true}).trim());
 const trace:any[]=[]; const sample=async()=>{const data=read();const status=await app.evaluate(()=>{const f=(globalThis as any).fixture;return f.service.status(f.id);});trace.push({at:new Date().toISOString(),...data,status});return data.surface;};
 const settle=async(check:(v:any)=>boolean)=>{const deadline=Date.now()+15000;let value;do{value=await sample();if(check(value))return value;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);console.log('RDP surface diagnostic',JSON.stringify(trace));return value;};
 const bounds=async(visible:boolean,width=800)=>{await app.evaluate(({}, {visible,width})=>{const f=(globalThis as any).fixture;f.service.send(f.id,{op:'bounds',x:20,y:70,width,height:500,visible});},{visible,width});await new Promise(r=>setTimeout(r,250));};
 await bounds(true);let first=await settle(v=>v?.visible&&v.owner===target.owner);assert.ok(first);assert.equal(first.owner,target.owner);assert.equal(first.appWindow,false);assert.equal(first.visible,true);assert.ok(first.width>400&&first.height>200);
 await bounds(false);assert.equal((await settle(v=>v&&!v.visible)).visible,false,'inactive tab/menu hides native surface');
 await bounds(true,700);const restored=await settle(v=>v?.visible&&v.width<first.width&&v.owner===target.owner);assert.equal(restored.hwnd,first.hwnd,'tab restoration reuses surface');assert.equal(restored.visible,true);assert.equal(restored.owner,target.owner,'restore preserves the actual Electron owner');assert.ok(restored.width<first.width);
 await app.evaluate(()=>{(globalThis as any).fixture.win.minimize();});await bounds(false);assert.equal((await settle(v=>v&&!v.visible)).visible,false,'minimize hides surface');
 await app.evaluate(()=>{(globalThis as any).fixture.win.restore();});await bounds(true);const afterMinimize=await settle(v=>v?.visible&&v.owner===target.owner);assert.equal(afterMinimize.visible,true,'restore shows same surface');assert.equal(afterMinimize.owner,target.owner,'minimize/restore preserves Electron owner');
 await app.evaluate(()=>{const f=(globalThis as any).fixture;f.service.close(f.id);});await new Promise(r=>setTimeout(r,1800));assert.equal((await settle(v=>v===null)),null,'close removes native surface');
 console.log('RDP surface diagnostic',JSON.stringify(trace));
 console.log('PASS real ActiveX owned surface: no taskbar entry, bounds, tab/menu hide, restore, minimize, close');
}finally{await app.evaluate(async()=>{(globalThis as any).fixture?.service.dispose();await new Promise(r=>setTimeout(r,2000));}).catch(()=>{});await app.close();await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:500});}
