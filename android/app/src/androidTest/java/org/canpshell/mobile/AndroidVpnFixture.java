package org.canpshell.mobile;
import android.app.*;import android.content.*;import android.os.*;import org.json.*;import java.io.*;import java.lang.reflect.*;import java.nio.charset.StandardCharsets;import java.util.*;
/** Isolated emulator only: real VpnService/TUN with a controlled reverse-HTTP exit. */
final class AndroidVpnFixture {
 static void field(Object target,Class<?> type,String name,Object value)throws Exception{Field f=type.getDeclaredField(name);f.setAccessible(true);f.set(target,value);}
 static String run(Instrumentation runner)throws Exception{
  if(!Build.FINGERPRINT.contains("generic")&&!Build.MODEL.contains("sdk_gphone"))throw new IOException("Emulator-only VPN fixture");
  Context c=runner.getTargetContext();AndroidHostProtocolTest.Capture backend=new AndroidHostProtocolTest.Capture();AndroidAgentHost host=new AndroidAgentHost(c,backend);AndroidAgentService fake=new AndroidAgentService();
  File stop=new File(c.getFilesDir(),"vpn-fixture-stop"),fail=new File(c.getFilesDir(),"vpn-fixture-expire"),receipt=new File(c.getFilesDir(),"vpn-fixture-receipt");stop.delete();fail.delete();receipt.delete();
  c.getSharedPreferences("cagent-host-peers",0).edit().putBoolean("peer.vpn-fixture",true).commit();
  field(fake,AndroidAgentService.class,"host",host);field(fake,AndroidAgentService.class,"hostReady",true);field(null,AndroidAgentService.class,"current",fake);
  AndroidNetworkProxy proxy=host.networkProxy;JSONObject lease=(JSONObject)proxy.call("network.proxy.start",new JSONObject().put("binding",UUID.randomUUID().toString()),"vpn-fixture");String id=lease.getString("id");Map<String,StringBuilder> requests=new HashMap<>();Set<String> connected=new HashSet<>();
  try{
   c.startActivity(new Intent(c,AndroidMachineVpnActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));Bundle ready=new Bundle();ready.putString("stream","VPN_FIXTURE_READY");runner.sendStatus(0,ready);
   long deadline=System.currentTimeMillis()+240000;
   while(!stop.exists()&&System.currentTimeMillis()<deadline){
    if(fail.exists()){proxy.close();Thread.sleep(100);continue;}
    JSONArray channels=((JSONObject)proxy.call("network.proxy.poll",new JSONObject().put("id",id),"vpn-fixture")).getJSONArray("channels");for(int i=0;i<channels.length();i++)requests.put(channels.getString(i),new StringBuilder());
    for(String channel:new ArrayList<>(requests.keySet())){JSONObject p=new JSONObject().put("id",id).put("channel",channel);String data=((JSONObject)proxy.call("network.proxy.read",p,"vpn-fixture")).optString("data");if(data.isEmpty())continue;StringBuilder request=requests.get(channel);request.append(new String(Base64.getDecoder().decode(data),StandardCharsets.US_ASCII));if(request.indexOf("\r\n\r\n")<0)continue;
     String reply;if(connected.add(channel)){if(!request.toString().startsWith("CONNECT "))throw new IOException("Expected CONNECT");try(FileOutputStream out=new FileOutputStream(receipt,true)){out.write((request.toString().split("\r\n")[0]+"\n").getBytes(StandardCharsets.UTF_8));}reply="HTTP/1.1 200 OK\r\n\r\n";}else{reply="HTTP/1.1 200 OK\r\nContent-Length: 23\r\nConnection: close\r\n\r\nVPN_CONTROLLED_EXIT_OK!!";}
     request.setLength(0);proxy.call("network.proxy.write",p.put("data",Base64.getEncoder().encodeToString(reply.getBytes(StandardCharsets.US_ASCII))),"vpn-fixture");
    }Thread.sleep(20);
   }return "OK VPN fixture finished";
  }finally{c.stopService(new Intent(c,AndroidMachineVpnService.class));Thread.sleep(200);field(null,AndroidAgentService.class,"current",null);host.close();backend.close();c.getSharedPreferences("cagent-host-peers",0).edit().remove("peer.vpn-fixture").commit();}
 }
}
