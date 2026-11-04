package org.canpshell.mobile;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.io.*;
import java.util.concurrent.atomic.AtomicInteger;

public class AndroidAppNetworkTest {
  public static void main(String[] args)throws Exception {
    AtomicInteger direct=new AtomicInteger(),proxied=new AtomicInteger();
    HttpServer origin=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
    HttpServer proxy=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
    origin.createContext("/",exchange->{direct.incrementAndGet();byte[] b="direct".getBytes();exchange.sendResponseHeaders(200,b.length);exchange.getResponseBody().write(b);exchange.close();});
    proxy.createContext("/",exchange->{proxied.incrementAndGet();byte[] b="proxy".getBytes();exchange.sendResponseHeaders(200,b.length);exchange.getResponseBody().write(b);exchange.close();});
    origin.start();proxy.start();
    try {
      URL url=new URL("http://127.0.0.1:"+origin.getAddress().getPort()+"/payload");
      Proxy route=new Proxy(Proxy.Type.HTTP,proxy.getAddress());
      if(!read(AndroidAppNetwork.open(url,true,()->route)).equals("proxy")||direct.get()!=0||proxied.get()!=1)throw new AssertionError("Selected exit bypassed");
      for(AndroidAppNetwork.ProxySource unavailable:new AndroidAppNetwork.ProxySource[]{()->{throw new IOException("lease expired");},()->Proxy.NO_PROXY,()->null}) {
        try{read(AndroidAppNetwork.open(url,true,unavailable));throw new AssertionError("Missing exit fell back");}catch(IOException expected){}
      }
      proxy.stop(0);
      try{read(AndroidAppNetwork.open(url,true,()->route));throw new AssertionError("Dead exit succeeded");}catch(IOException expected){}
      if(direct.get()!=0)throw new AssertionError("Failed proxy contacted origin");
      if(!read(AndroidAppNetwork.open(url,false,()->{throw new AssertionError("Unselected route touched");})).equals("direct"))throw new AssertionError();
      try{AndroidAppNetwork.open(new URL("file:///private"),false,()->route);throw new AssertionError("File URL allowed");}catch(IOException expected){}
      System.out.println("App data route: selected proxy, lost lease, dead proxy, explicit direct and protocol checks passed");
    }finally{origin.stop(0);proxy.stop(0);}
  }
  static String read(HttpURLConnection c)throws Exception {c.setConnectTimeout(1000);c.setReadTimeout(1000);try(InputStream in=c.getInputStream()){return new String(in.readAllBytes());}finally{c.disconnect();}}
}
