package org.canpshell.mobile;
import android.app.*;
import android.content.*;
import android.os.*;
import org.json.*;
import java.io.*;
import java.net.ServerSocket;
import java.util.*;
/** Emulator-only real authenticated launcher request and OS foreground observation. */
final class AndroidApplicationsTest {
 static String run(Instrumentation runner)throws Exception {
  if(!Build.HARDWARE.equals("ranchu")&&!Build.HARDWARE.equals("goldfish"))throw new IllegalStateException("Emulator only");
  Context context=runner.getTargetContext();AndroidHostProtocolTest.Capture capture=new AndroidHostProtocolTest.Capture();AndroidAgentHost host=new AndroidAgentHost(context,capture);AgentConnection client=new AgentConnection((t,v)->{});Activity activity=null;
  try {
   int port;try(ServerSocket s=new ServerSocket(0)){port=s.getLocalPort();}String password="fixture-"+UUID.randomUUID();host.start(port,password);client.connect("127.0.0.1",port,password,c->true);boolean rejected;
   JSONArray apps=(JSONArray)client.manage("applications.list",new JSONObject());boolean settings=false;for(int i=0;i<apps.length();i++)if("com.android.settings".equals(apps.getJSONObject(i).getString("id")))settings=true;if(!settings)throw new AssertionError("Emulator Settings launcher unavailable");
   activity=runner.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));runner.waitForIdleSync();
   JSONObject result=(JSONObject)client.manage("packages.invoke",new JSONObject().put("packageId","cagent.android").put("toolId","android_app_launch").put("args",new JSONObject().put("packageName","com.android.settings")));
   if(!result.optBoolean("submitted")||result.has("foreground")||result.has("launched"))throw new AssertionError("Launch response overstated OS result");
   long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(10);boolean foreground=false;
   while(System.nanoTime()<deadline&&!foreground){try(ParcelFileDescriptor fd=runner.getUiAutomation().executeShellCommand("dumpsys activity activities");InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(fd)){ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[4096];int n;while((n=in.read(b))>0&&out.size()<1024*1024)out.write(b,0,n);for(String line:out.toString("UTF-8").split("\\n"))if((line.contains("mResumedActivity")||line.contains("topResumedActivity"))&&line.contains("com.android.settings/"))foreground=true;}if(!foreground)Thread.sleep(100);}
   if(!foreground)throw new AssertionError("Authenticated Settings launch did not reach top activity");
   rejected=false;try{client.manage("packages.invoke",new JSONObject().put("packageId","not.authorized").put("toolId","android_app_launch").put("args",new JSONObject().put("packageName","com.android.settings")));}catch(Exception e){rejected=true;}if(!rejected)throw new AssertionError("Wrong package namespace accepted");
   return "OK (Android launcher list, authenticated launch, real top activity and namespace rejection)";
  }finally{client.close();host.close();capture.close();if(activity!=null){Activity current=activity;runner.runOnMainSync(current::finish);}context.startActivity(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));}
 }
}
