using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
public class ExitRegression {
 static FieldInfo Field(string name){return typeof(CagentWindow).GetField(name,BindingFlags.NonPublic|BindingFlags.Instance);}
 [STAThread] public static int Main(string[] args){
  int result=1;var app=new Application{ShutdownMode=ShutdownMode.OnExplicitShutdown};
  app.Startup+=async(s,e)=>{Process ended=null;CagentWindow window=null;try{
   ended=Process.Start(new ProcessStartInfo(args[0],"-e \"process.exit(0)\""){UseShellExecute=false,CreateNoWindow=true});
   if(!ended.WaitForExit(10000))throw new Exception("Fixture process did not exit");
   window=new CagentWindow(new[]{"--fixture"});Field("fixture").SetValue(window,false);Field("connected").SetValue(window,true);Field("host").SetValue(window,ended);
   // Invalid origin makes any attempted request fail. A dead owned process must not be contacted.
   Field("origin").SetValue(window,"http://127.0.0.1:0");Field("token").SetValue(window,new string('a',64));
   await (Task)typeof(CagentWindow).GetMethod("ExitApp",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(window,null);
   if(!(bool)Field("exiting").GetValue(window))throw new Exception("Dead host prevents native window exit: "+((TextBlock)Field("status").GetValue(window)).Text);
   window=null;
   var alive=new CagentWindow(new[]{"--fixture"});window=alive;Field("fixture").SetValue(alive,false);Field("connected").SetValue(alive,true);Field("host").SetValue(alive,Process.GetCurrentProcess());Field("origin").SetValue(alive,"http://127.0.0.1:0");Field("token").SetValue(alive,new string('a',64));
   await (Task)typeof(CagentWindow).GetMethod("ExitApp",BindingFlags.NonPublic|BindingFlags.Instance).Invoke(alive,null);
   if((bool)Field("exiting").GetValue(alive)||!((TextBlock)Field("status").GetValue(alive)).Text.Contains("退出失败"))throw new Exception("Live host failure was silently ignored");
   Console.WriteLine("PASS native exit with dead owned host; live host errors remain visible");result=0;
  }catch(Exception error){Console.Error.WriteLine(error);}
  finally{if(window!=null){Field("exiting").SetValue(window,true);window.Close();}if(ended!=null)ended.Dispose();app.Shutdown();}};
  app.Run();return result;
 }
}
