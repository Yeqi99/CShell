using System;
using System.IO;
using System.Drawing;
using System.Windows.Forms;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Runtime.InteropServices;
// Explicit temporary acceptance window. Logs only input directed to this form.
class DesktopAcceptance : Form {
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
 [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
 readonly string root=Environment.GetEnvironmentVariable("CSHELL_ACCEPTANCE_DIR")??AppDomain.CurrentDomain.BaseDirectory;
 readonly TextBox input=new TextBox();readonly Button button=new Button();readonly Panel motion=new Panel();
 readonly List<object> events=new List<object>();readonly JavaScriptSerializer json=new JavaScriptSerializer();int tick=0;DateTime started=DateTime.UtcNow;
 void Log(string kind,object value){events.Add(new {time=DateTime.UtcNow.ToString("o"),kind=kind,value=value});if(events.Count>300)events.RemoveAt(0);}
 void Save(){if(!IsHandleCreated)return;var box=input.RectangleToScreen(input.ClientRectangle);var b=button.RectangleToScreen(button.ClientRectangle);uint foregroundPid;var fg=GetForegroundWindow();GetWindowThreadProcessId(fg,out foregroundPid);var text=json.Serialize(new {pid=System.Diagnostics.Process.GetCurrentProcess().Id,foreground=fg==Handle,foregroundPid=foregroundPid,at=DateTime.UtcNow.ToString("o"),shiftDown=(GetAsyncKeyState(0x10)&0x8000)!=0,text=input.Text,events=events,screen=Screen.FromControl(this).Bounds,input=new{x=box.X,y=box.Y,width=box.Width,height=box.Height},button=new{x=b.X,y=b.Y,width=b.Width,height=b.Height},tick=tick});var path=Path.Combine(root,"desktop-input-receipt.json"+(Environment.GetEnvironmentVariable("CSHELL_ACCEPTANCE_DIR")!=null?"."+(tick%2):""));var next=path+".tmp";File.WriteAllText(next,text);if(File.Exists(path))File.Replace(next,path,null);else File.Move(next,path);}
 DesktopAcceptance(){Text="CAgent — LOCAL KEYBOARD / MOUSE TEST (90 seconds maximum)";StartPosition=FormStartPosition.Manual;Location=new Point(80,80);Size=new Size(620,300);TopMost=true;BackColor=Color.White;KeyPreview=true;
 var label=new Label{Text="LOCAL INPUT TEST — only this window receives test input.\nChanging focus stops the test. No remote server is accessed.",ForeColor=Color.DarkRed,Location=new Point(20,15),Size=new Size(570,50)};
 input.Location=new Point(20,70);input.Width=360;input.ImeMode=ImeMode.Disable;button.Text="Test click";button.Location=new Point(400,68);button.Size=new Size(130,32);motion.Location=new Point(20,140);motion.Size=new Size(50,70);motion.BackColor=Color.Teal;Controls.AddRange(new Control[]{label,input,button,motion});
 input.KeyDown+=(s,e)=>Log("keyDown",(int)e.KeyCode);input.KeyUp+=(s,e)=>Log("keyUp",(int)e.KeyCode);input.TextChanged+=(s,e)=>Log("text",input.Text);button.Click+=(s,e)=>Log("click",true);button.MouseDown+=(s,e)=>Log("mouseDown",e.Button.ToString());button.MouseUp+=(s,e)=>Log("mouseUp",e.Button.ToString());MouseWheel+=(s,e)=>Log("wheel",e.Delta);Deactivate+=(s,e)=>{Log("deactivated",true);Save();};
 var timer=new Timer{Interval=25};timer.Tick+=(s,e)=>{tick++;motion.Left=20+(tick*5)%500;Save();bool parentGone=false;int parent;if(int.TryParse(Environment.GetEnvironmentVariable("CSHELL_ACCEPTANCE_PARENT"),out parent))try{parentGone=System.Diagnostics.Process.GetProcessById(parent).HasExited;}catch{parentGone=true;}if(parentGone||File.Exists(Path.Combine(root,"stop"))||DateTime.UtcNow-started>TimeSpan.FromSeconds(90))Close();};Shown+=(s,e)=>{Activate();input.Focus();timer.Start();Save();};FormClosed+=(s,e)=>{timer.Stop();Save();};
 }
 [STAThread]static void Main(){SetProcessDPIAware();Application.EnableVisualStyles();Application.Run(new DesktopAcceptance());}
}
