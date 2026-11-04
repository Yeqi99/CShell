package org.canpshell.mobile;
import java.net.*;import java.io.*;import java.util.*;import java.util.concurrent.atomic.AtomicBoolean;import org.json.*;
public final class AndroidNetworkTest {
 static JSONObject obj(Object v){return (JSONObject)v;}
 static void require(boolean v){if(!v)throw new AssertionError();}
 interface Action{void run()throws Exception;}
 static void denied(Action a)throws Exception{try{a.run();throw new AssertionError("Expected rejection");}catch(IOException expected){}}
 public static void main(String[] args)throws Exception{
  AtomicBoolean authorized=new AtomicBoolean(true);
  AndroidNetworkProxy proxy=new AndroidNetworkProxy(o->authorized.get()&&o.equals("owner"),(s,o,b)->{},false,"","");
  AndroidNetworkStreams streams=new AndroidNetworkStreams(proxy,o->authorized.get()&&o.equals("owner"));
  try(ServerSocket target=new ServerSocket(0,4,InetAddress.getLoopbackAddress())){
   Thread echo=new Thread(()->{try(Socket socket=target.accept()){byte[] b=new byte[4];new DataInputStream(socket.getInputStream()).readFully(b);socket.getOutputStream().write(b);}catch(Exception e){throw new RuntimeException(e);}});echo.start();
   String stream=obj(streams.call("browser.open",new JSONObject().put("host","127.0.0.1").put("port",target.getLocalPort()),"owner")).getString("id");
   JSONObject write=new JSONObject().put("id",stream).put("sequence",0).put("data","dGVzdA==");
   streams.call("browser.write",write,"owner");denied(()->streams.call("browser.write",write,"owner"));
   String received="";for(int i=0;i<100&&received.isEmpty();i++)received=obj(streams.call("browser.read",new JSONObject().put("id",stream),"owner")).getString("data");require(received.equals("dGVzdA=="));echo.join(2000);
   String binding=UUID.randomUUID().toString();JSONObject lease=obj(proxy.call("network.proxy.start",new JSONObject().put("binding",binding),"owner"));
   try(Socket client=new Socket("127.0.0.1",lease.getInt("port"))){
    client.setSoTimeout(2000);client.getOutputStream().write("GET / HTTP/1.1\r\n\r\n".getBytes());
    JSONArray channels=new JSONArray();for(int i=0;i<100&&channels.length()==0;i++){channels=obj(proxy.call("network.proxy.poll",new JSONObject().put("id",lease.getString("id")),"owner")).getJSONArray("channels");Thread.sleep(5);}require(channels.length()==1);
    JSONObject channel=new JSONObject().put("id",lease.getString("id")).put("channel",channels.getString(0));String data="";for(int i=0;i<100&&data.isEmpty();i++)data=obj(proxy.call("network.proxy.read",channel,"owner")).getString("data");require(new String(Base64.getDecoder().decode(data)).startsWith("GET"));
    proxy.call("network.proxy.write",channel.put("data","b2s="),"owner");require(client.getInputStream().read()==111);
    authorized.set(false);proxy.expire();streams.expire();denied(()->proxy.port());require(proxy.configured());
   }
   authorized.set(true);denied(()->streams.call("browser.open",new JSONObject().put("host","127.0.0.1").put("port",target.getLocalPort()),"owner"));
   require(obj(proxy.call("network.proxy.clear",new JSONObject().put("binding",UUID.randomUUID().toString()),"owner")).getBoolean("superseded"));require(proxy.configured());
   proxy.call("network.proxy.clear",new JSONObject().put("binding",binding),"owner");require(!proxy.configured());
  }finally{streams.close();proxy.close();}
  System.out.println("Android network: real duplex, sequence, reverse ingress, ownership revocation, fail-closed and stale-binding checks passed");
 }
}
