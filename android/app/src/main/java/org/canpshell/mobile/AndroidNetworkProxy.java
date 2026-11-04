package org.canpshell.mobile;
import java.io.*;import java.net.*;import java.util.*;import java.util.concurrent.*;import java.util.function.Predicate;import org.json.*;
/** Authenticated controller-owned loopback ingress. No global proxy or firewall changes. */
final class AndroidNetworkProxy implements AutoCloseable {
 interface Persistence{void save(boolean selected,String owner,String binding)throws Exception;}
 private final Predicate<String> allowed;private final Persistence persistence;private final Map<String,AndroidNetworkChannel> channels=new HashMap<>();
 private boolean selected;private String owner="",binding="",id="";private ServerSocket server;private long expires;
 AndroidNetworkProxy(Predicate<String> allowed,Persistence persistence,boolean selected,String owner,String binding){this.allowed=allowed;this.persistence=persistence;this.selected=selected;this.owner=owner;this.binding=binding;}
 synchronized boolean configured(){return selected;}
 private void check(String caller,String lease)throws IOException{if(!allowed.test(caller))throw new IOException("Network proxy not authorized");if(lease!=null&&(!owner.equals(caller)||!id.equals(lease)||server==null||expires<System.currentTimeMillis()))throw new IOException("Network proxy lease expired");}
 synchronized Proxy proxy()throws IOException{if(!selected)return Proxy.NO_PROXY;check(owner,id);return new Proxy(Proxy.Type.HTTP,new InetSocketAddress("127.0.0.1",server.getLocalPort()));}
 synchronized int port()throws IOException{if(!selected)throw new IOException("No selected proxy");check(owner,id);return server.getLocalPort();}
 synchronized void expire(){if(server!=null&&(expires<System.currentTimeMillis()||!allowed.test(owner)))close();}
 synchronized Object call(String method,JSONObject p,String caller)throws Exception{
  check(caller,null);
  if(method.equals("network.proxy.clear")){String b=p.getString("binding");UUID.fromString(b);if(!binding.equals(b))return new JSONObject().put("cleared",false).put("superseded",true);if(!owner.equals(caller))throw new IOException("Proxy belongs to another controller");persistence.save(false,"","");selected=false;owner="";binding="";close();return new JSONObject().put("cleared",true);}
  if(method.equals("network.proxy.start")){
   if(selected&&!owner.equals(caller))throw new IOException("Proxy belongs to another controller");String next=p.optString("binding",UUID.randomUUID().toString());UUID.fromString(next);
   persistence.save(true,caller,next);selected=true;owner=caller;binding=next;close();
   ServerSocket listener=new ServerSocket();listener.bind(new InetSocketAddress("127.0.0.1",0),16);server=listener;id=UUID.randomUUID().toString();expires=System.currentTimeMillis()+15000;
   Thread accept=new Thread(()->{while(!listener.isClosed())try{Socket socket=listener.accept();synchronized(this){if(server!=listener||channels.size()>=32||!allowed.test(owner)||expires<System.currentTimeMillis()){socket.close();continue;}channels.put(UUID.randomUUID().toString(),new AndroidNetworkChannel(socket));}}catch(Exception ignored){}},"cagent-reverse-proxy");accept.setDaemon(true);accept.start();
   return new JSONObject().put("id",id).put("port",listener.getLocalPort());
  }
  check(caller,p.getString("id"));expires=System.currentTimeMillis()+15000;
  if(method.equals("network.proxy.stop")){persistence.save(false,"","");selected=false;owner="";binding="";close();return new JSONObject().put("closed",true);}
  if(method.equals("network.proxy.poll")){JSONArray values=new JSONArray();for(Map.Entry<String,AndroidNetworkChannel> e:channels.entrySet())if(!e.getValue().announced){e.getValue().announced=true;values.put(e.getKey());}return new JSONObject().put("channels",values);}
  String channel=p.getString("channel");AndroidNetworkChannel c=channels.get(channel);if(c==null)throw new IOException("Network channel unavailable");
  if(method.equals("network.proxy.read"))return c.read();
  if(method.equals("network.proxy.write"))return c.write(p.getString("data"),null);
  if(method.equals("network.proxy.close")){channels.remove(channel);c.close();return new JSONObject().put("closed",true);}
  throw new IOException("Unknown network proxy operation");
 }
 public synchronized void close(){if(server!=null)try{server.close();}catch(IOException ignored){}server=null;for(AndroidNetworkChannel c:channels.values())c.close();channels.clear();id="";expires=0;}
}
