import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import type {Profile} from '../shared/contracts';
import {rdpProfileSchema} from '../core/rdp';

// A real Microsoft RDP ActiveX control in an Electron-owned native surface.
// The borderless owned HWND tracks the tab rectangle; cross-process WS_CHILD
// surfaces are unreliable with Chromium composition and Windows activation.
// Credentials use private stdin only. No mstsc process or public listener is used.
const source=String.raw`
using System; using System.Windows.Forms; using System.Runtime.InteropServices; using System.Threading; using System.Web.Script.Serialization;
class Rdp:AxHost { public Rdp():base("A0C63C30-F08D-4AB4-907C-34905D770C7D"){} public dynamic Client {get{return GetOcx();}} }
class Host:Form {
 [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
 [StructLayout(LayoutKind.Sequential)] struct Rect {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window,out Rect rect);
 [StructLayout(LayoutKind.Sequential)] struct Point {public int X,Y;}
 [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window,ref Point point);
 [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr window,int index,IntPtr value);
 IntPtr owner=IntPtr.Zero; int lastX=int.MinValue,lastY,lastWidth,lastHeight;
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
 Rdp r=new Rdp(); JavaScriptSerializer json=new JavaScriptSerializer(){MaxJsonLength=131072,RecursionLimit=8}; DateTime started; bool connected=false; string secret=""; readonly Guid events=new Guid("336d5562-efa8-482e-8cb3-c5c0fc7a7db6");
 void Disconnected(int reason){int extended=0;string description="远程桌面连接已结束";try{extended=(int)r.Client.ExtendedDisconnectReason;description=(string)r.Client.GetErrorDescription(reason,extended);}catch{}if(secret.Length>0)description=description.Replace(secret,"[redacted]");Emit(connected?"closed":"failed",description+" (RDP "+reason+", extended "+extended+")");BeginInvoke(new Action(()=>Close()));}
 string ReadCommand(){var b=new System.Text.StringBuilder();int n;while((n=Console.In.Read())!=-1){if(n==10)return b.ToString();if(b.Length>=131072)throw new InvalidOperationException();if(n!=13)b.Append((char)n);}return b.Length==0?null:b.ToString();}
 void Emit(string state,string message){Console.Out.WriteLine(json.Serialize(new {state=state,message=message}));Console.Out.Flush();}
 void Command(string line){try {var d=json.Deserialize<System.Collections.Generic.Dictionary<string,object>>(line); string op=(string)d["op"];
 if(op=="open") {owner=new IntPtr(long.Parse((string)d["parent"]));SetWindowLongPtr(Handle,-8,owner);
 Rect area;bool measured=GetClientRect(new IntPtr(long.Parse((string)d["parent"])),out area); dynamic c=r.Client; c.DesktopWidth=measured?Math.Max(640,Math.Min(3840,area.Right-area.Left)):1280;c.DesktopHeight=measured?Math.Max(480,Math.Min(2160,area.Bottom-area.Top)):800; ClientSize=new System.Drawing.Size((int)c.DesktopWidth,(int)c.DesktopHeight);r.PerformLayout();c.Server=(string)d["host"];c.UserName=(string)d["username"];c.AdvancedSettings9.RDPPort=Convert.ToInt32(d["port"]);c.AdvancedSettings9.EnableCredSspSupport=true;c.AdvancedSettings9.AuthenticationLevel=2;c.AdvancedSettings9.SmartSizing=true;
 ComEventsHelper.Combine(c,events,4,new Action<int>(Disconnected));ComEventsHelper.Combine(c,events,10,new Action<int>(code=>{Emit("failed","RDP fatal error "+code);BeginInvoke(new Action(()=>Close()));}));secret=(string)d["password"];c.AdvancedSettings9.ClearTextPassword=secret;started=DateTime.UtcNow;Emit("connecting","正在连接远程桌面");c.Connect();}
 else if(op=="bounds") {bool visible=Convert.ToBoolean(d["visible"]); if(visible){if(!Visible)Show();if(!r.Visible)r.Show();}else if(Visible)Hide(); Point point=new Point(){X=Convert.ToInt32(d["x"]),Y=Convert.ToInt32(d["y"])};ClientToScreen(owner,ref point);int width=Math.Max(1,Convert.ToInt32(d["width"])),height=Math.Max(1,Convert.ToInt32(d["height"]));if(point.X!=lastX||point.Y!=lastY||width!=lastWidth||height!=lastHeight){SetWindowPos(Handle,IntPtr.Zero,point.X,point.Y,width,height,0x10);lastX=point.X;lastY=point.Y;lastWidth=width;lastHeight=height;}}
 else if(op=="close"){Close();}
 }catch(Exception e){Emit("failed","RDP 操作失败 (HRESULT "+e.GetBaseException().HResult+")");Close();}}
 protected override bool ShowWithoutActivation {get{return true;}}
 Host(){Text="CShell RDP surface";FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;Width=1280;Height=800;r.Dock=DockStyle.Fill;Controls.Add(r);
 Shown+=(s,e)=>{Hide();var t=new Thread(()=>{try{string line;DateTime interval=DateTime.UtcNow;int count=0;while((line=ReadCommand())!=null){if((DateTime.UtcNow-interval).TotalSeconds>=1){interval=DateTime.UtcNow;count=0;}if(++count>1000)throw new InvalidOperationException();string v=line;try{Invoke(new Action(()=>Command(v)));}catch{return;}}try{BeginInvoke(new Action(()=>Close()));}catch{}}catch{try{BeginInvoke(new Action(()=>{Emit("failed","RDP 宿主输入超出限制");Close();}));}catch{}}});t.IsBackground=true;t.Start();};
 var timer=new System.Windows.Forms.Timer();timer.Interval=250;timer.Tick+=(s,e)=>{if(started==default(DateTime))return;try{int n=(int)r.Client.Connected;if(n==1&&!connected){connected=true;Emit("connected","远程桌面已连接");}else if(n==0&&connected){Emit("closed","远程桌面已断开");Close();}else if(!connected&&(DateTime.UtcNow-started).TotalSeconds>45){Emit("failed","远程桌面连接超时，请检查网络、凭据和目标远程桌面设置");Close();}}catch{}};timer.Start();
 FormClosing+=(s,e)=>{try{if((int)r.Client.Connected!=0)r.Client.Disconnect();}catch{}};}
 [STAThread] static void Main(){try{try{SetProcessDpiAwarenessContext(new IntPtr(-4));}catch{}Console.OutputEncoding=new System.Text.UTF8Encoding(false);Application.EnableVisualStyles();Application.Run(new Host());}catch(Exception e){Console.WriteLine(new JavaScriptSerializer().Serialize(new {state="failed",message="RDP 宿主启动失败 (HRESULT "+e.GetBaseException().HResult+")"}));}}
}`;
type State={state:string;message:string};
type Session={child:ChildProcessWithoutNullStreams;status:State};
export class EmbeddedRdpService {
 private sessions=new Map<string,Session>(); private opening=new Map<string,Promise<State>>(); private executable?:Promise<string>; private generations=new Map<string,number>();
 constructor(private directory:string){}
 private build(){return this.executable??=(async()=>{if(process.platform!=='win32')throw Error('内嵌 RDP 当前支持 Windows');const dir=join(this.directory,createHash('sha256').update(source).digest('hex').slice(0,16));await mkdir(dir,{recursive:true});const exe=join(dir,'CShell.RdpHost.exe');try{await access(exe);return exe;}catch{}const cs=join(dir,'Host.cs');await writeFile(cs,source);await new Promise<void>((resolve,reject)=>{const compiler=join(process.env.SystemRoot||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');const p=spawn(compiler,['/noconfig','/nologo','/r:System.dll','/r:System.Core.dll','/target:exe','/out:'+exe,'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll','/r:Microsoft.CSharp.dll',cs],{windowsHide:true});const timer=setTimeout(()=>{p.kill();reject(Error('RDP 宿主构建超时'));},30000);p.stdout.resume();p.stderr.resume();p.on('error',()=>{clearTimeout(timer);reject(Error('缺少 Windows .NET 编译组件'));});p.on('close',n=>{clearTimeout(timer);n===0?resolve():reject(Error('RDP 宿主构建失败，退出码 '+n));});});return exe;})().catch(error=>{this.executable=undefined;throw error;});}
 async open(profile:Profile,password:string,parent:Buffer){const p=rdpProfileSchema.parse(profile);if(this.sessions.has(p.id))return this.status(p.id);if(this.sessions.size+this.opening.size>=8)throw Error('请先关闭不用的远程桌面');const pending=this.opening.get(p.id);if(pending)return pending;const generation=(this.generations.get(p.id)||0)+1;this.generations.set(p.id,generation);const work=(async()=>{const exe=await this.build();if(this.generations.get(p.id)!==generation)throw Error('RDP 连接已取消');const child=spawn(exe,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});const session:Session={child,status:{state:'connecting',message:'正在连接远程桌面'}};this.sessions.set(p.id,session);createInterface({input:child.stdout}).on('line',line=>{try{const v=JSON.parse(line);if(typeof v.state==='string'&&typeof v.message==='string')session.status=v;}catch{}});child.stderr.resume();child.stdin.on('error',()=>{});child.on('error',()=>session.status={state:'failed',message:'无法启动 RDP 宿主'});child.on('exit',()=>{if(['connecting','connected'].includes(session.status.state))session.status={state:'closed',message:'远程桌面已关闭'};});this.send(p.id,{op:'open',host:p.host,username:p.username,port:p.port,password,parent:(parent.length===8?parent.readBigUInt64LE():BigInt(parent.readUInt32LE())).toString()});return session.status;})();this.opening.set(p.id,work);try{return await work;}finally{if(this.opening.get(p.id)===work)this.opening.delete(p.id);}}
 send(id:string,value:unknown){const s=this.sessions.get(id);if(s&&!s.child.stdin.destroyed){const line=JSON.stringify(value);if(line.length>131072)throw Error('RDP 请求超出限制');if(s.child.stdin.writableLength>262144)return;s.child.stdin.write(line+'\n');}}
 status(id:string){return this.sessions.get(id)?.status??{state:'closed',message:'尚未连接'};}
 close(id:string){this.generations.set(id,(this.generations.get(id)||0)+1);this.opening.delete(id);const s=this.sessions.get(id);if(!s)return;this.send(id,{op:'close'});this.sessions.delete(id);setTimeout(()=>{if(s.child.exitCode===null)s.child.kill();},1500).unref();}
 dispose(){for(const id of new Set([...this.sessions.keys(),...this.opening.keys()]))this.close(id);}
}
