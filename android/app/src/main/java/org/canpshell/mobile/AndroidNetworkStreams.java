package org.canpshell.mobile;
import java.io.*;import java.net.*;import java.nio.charset.StandardCharsets;import java.util.*;import java.util.function.Predicate;import org.json.*;
/** Real browser egress on Android, using its configured identity route without direct fallback. */
final class AndroidNetworkStreams implements AutoCloseable {
 private final AndroidNetworkProxy proxy;private final Predicate<String> allowed;private final Map<String,Entry> entries=new HashMap<>();
 private static final class Entry{String owner;AndroidNetworkChannel channel;long expires;Entry(String owner,AndroidNetworkChannel channel){this.owner=owner;this.channel=channel;expires=System.currentTimeMillis()+60000;}}
 AndroidNetworkStreams(AndroidNetworkProxy proxy,Predicate<String> allowed){this.proxy=proxy;this.allowed=allowed;}
 synchronized Object call(String method,JSONObject p,String owner)throws Exception{
  if(!allowed.test(owner))throw new IOException("Browser network not authorized");expire();
  if(method.equals("browser.status"))return new JSONObject().put("available",true).put("transport","bounded-rpc");
  if(method.equals("browser.open")){
   if(entries.size()>=24)throw new IOException("Network stream limit reached");String host=p.getString("host");int port=p.getInt("port");if(host.length()<1||host.length()>253||!host.matches("[A-Za-z0-9.:-]+")||port<1||port>65535)throw new IOException("Invalid destination");
   Socket socket=new Socket();try{
    if(proxy.configured()){
     socket.connect(new InetSocketAddress("127.0.0.1",proxy.port()),15000);socket.setSoTimeout(15000);String authority=(host.contains(":")?"["+host+"]":host)+":"+port;
     socket.getOutputStream().write(("CONNECT "+authority+" HTTP/1.1\r\nHost: "+authority+"\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
     ByteArrayOutputStream header=new ByteArrayOutputStream();int b;while(header.size()<16384&&(b=socket.getInputStream().read())!=-1){header.write(b);byte[] bytes=header.toByteArray();int n=bytes.length;if(n>=4&&bytes[n-4]==13&&bytes[n-3]==10&&bytes[n-2]==13&&bytes[n-1]==10)break;}
     String response=header.toString("US-ASCII");if(!response.matches("(?s)^HTTP/1\\.[01] 200(?: |\\r).*\\r\\n\\r\\n$"))throw new IOException("Selected network exit unavailable");
    }else socket.connect(new InetSocketAddress(host,port),15000);
    socket.setSoTimeout(60000);if(!allowed.test(owner))throw new IOException("Browser network authorization changed");String id=UUID.randomUUID().toString();entries.put(id,new Entry(owner,new AndroidNetworkChannel(socket)));return new JSONObject().put("id",id);
   }catch(Exception e){try{socket.close();}catch(Exception ignored){}throw e;}
  }
  String id=p.getString("id");Entry entry=entries.get(id);if(entry==null||!entry.owner.equals(owner))throw new IOException("Network stream unavailable");entry.expires=System.currentTimeMillis()+60000;
  if(method.equals("browser.read"))return entry.channel.read();
  if(method.equals("browser.write"))return entry.channel.write(p.getString("data"),p.getLong("sequence"));
  if(method.equals("browser.close")){entries.remove(id);entry.channel.close();return new JSONObject().put("closed",true);}
  throw new IOException("Unknown browser network operation");
 }
 synchronized void expire(){Iterator<Entry> it=entries.values().iterator();while(it.hasNext()){Entry e=it.next();if(e.expires<System.currentTimeMillis()||!allowed.test(e.owner)){e.channel.close();it.remove();}}}
 public synchronized void close(){for(Entry e:entries.values())e.channel.close();entries.clear();}
}
