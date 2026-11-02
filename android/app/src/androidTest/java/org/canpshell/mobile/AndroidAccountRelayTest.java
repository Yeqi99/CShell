package org.canpshell.mobile;

import android.content.Context;
import org.json.JSONObject;
import javax.net.ssl.*;
import java.io.*;
import java.net.*;
import java.security.SecureRandom;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Real pinned outer TLS -> reverse channel -> independently authenticated Android host TLS. */
final class AndroidAccountRelayTest {
  private static JSONObject line(Socket s)throws Exception{ByteArrayOutputStream b=new ByteArrayOutputStream();int c;while((c=s.getInputStream().read())!=-1){if(c==10)return new JSONObject(b.toString("UTF-8"));if(b.size()>8192)throw new IOException();b.write(c);}throw new EOFException();}
  private static void write(Socket s,JSONObject value)throws Exception{synchronized(s){s.getOutputStream().write((value+"\n").getBytes(StandardCharsets.UTF_8));s.getOutputStream().flush();}}
  private static void check(boolean value,String message)throws Exception{if(!value)throw new Exception(message);}
  static String run(Context context)throws Exception{
    AndroidHostProtocolTest.Capture backend=new AndroidHostProtocolTest.Capture();AndroidAgentHost host=new AndroidAgentHost(context,backend);
    int port;try(ServerSocket reserve=new ServerSocket(0)){port=reserve.getLocalPort();}
    Relay relay=new Relay(context);AndroidAccountRelay reverse=null;
    try{
      host.start(port,"local-"+UUID.randomUUID());String password="account-"+UUID.randomUUID();host.accountPassword("fixture-account",password);
      JSONObject invitation=host.connectionInfo("127.0.0.1",port),endpoint=relay.endpoint(invitation.getString("deviceId"));
      reverse=new AndroidAccountRelay(port,()->endpoint);reverse.start();
      long deadline=System.currentTimeMillis()+10000;while(!reverse.status().optBoolean("connected")&&System.currentTimeMillis()<deadline)Thread.sleep(20);
      check(reverse.status().getBoolean("connected"),"Reverse register timeout");
      AgentConnection client=new AgentConnection((t,v)->{});
      try{
        // The nominal direct address is deliberately unreachable. Only the relay can succeed.
        client.connect("192.0.2.1",port,password,c->{try{return AndroidHostIdentity.fingerprint(c).equals(AndroidHostIdentity.fingerprint(relay.identity.certificate.getEncoded()));}catch(Exception e){return false;}},endpoint);
        check(((JSONObject)client.manage("client.status",new JSONObject())).getBoolean("running"),"Target TLS management unavailable");
        check(relay.channels>0,"Direct fallback used instead of reverse channel");
        host.clearAccount();boolean rejected=false;try{client.manage("client.status",new JSONObject());}catch(Exception expected){rejected=true;}check(rejected,"Account revoke retained access");
      }finally{client.close();}
      reverse.close();reverse=null;
      JSONObject wrong=new JSONObject(endpoint.toString()).put("fingerprint",String.join("",Collections.nCopies(64,"0")));
      int before=relay.registrations;reverse=new AndroidAccountRelay(port,()->wrong);reverse.start();Thread.sleep(1200);
      check(!reverse.status().optBoolean("connected")&&relay.registrations==before,"Wrong relay identity received credential");
      return "OK (Android account reverse TLS, target identity/password, no direct fallback, revoke, wrong-pin rejection)\n";
    }finally{if(reverse!=null)reverse.close();relay.close();host.close();backend.close();}
  }
  static final class Relay implements AutoCloseable{
    final SSLServerSocket listener;final ExecutorService workers=Executors.newCachedThreadPool();final Set<Socket> sockets=ConcurrentHashMap.newKeySet();final ConcurrentHashMap<String,Socket> pending=new ConcurrentHashMap<>();final AndroidHostIdentity identity;volatile Socket control;volatile int channels,registrations;
    Relay(Context context)throws Exception{identity=new AndroidHostIdentity(context);SSLContext tls=SSLContext.getInstance("TLSv1.3");tls.init(identity.managers,null,new SecureRandom());listener=(SSLServerSocket)tls.getServerSocketFactory().createServerSocket(0);workers.execute(()->{while(!listener.isClosed())try{SSLSocket s=(SSLSocket)listener.accept();sockets.add(s);workers.execute(()->serve(s));}catch(Exception ignored){}});}
    JSONObject endpoint(String id)throws Exception{return new JSONObject().put("host","127.0.0.1").put("port",listener.getLocalPort()).put("fingerprint",AndroidHostIdentity.fingerprint(identity.certificate.getEncoded())).put("targetId",id).put("credential","fixture-only");}
    void serve(SSLSocket s){boolean handed=false;try{s.setSoTimeout(10000);s.startHandshake();JSONObject hello=line(s);check(hello.optString("credential").equals("fixture-only"),"Wrong fixture credential");String op=hello.optString("operation");write(s,new JSONObject().put("ok",true));
      if(op.equals("register")){control=s;registrations++;while(!s.isClosed()){JSONObject ping=line(s);if(ping.optString("type").equals("ping"))write(s,new JSONObject().put("type","pong"));}}
      else if(op.equals("forward")){String id=UUID.randomUUID().toString().replace("-","")+UUID.randomUUID().toString().replace("-","");pending.put(id,s);handed=true;write(control,new JSONObject().put("type","open").put("requestId",id));}
      else if(op.equals("channel")){Socket peer=pending.remove(hello.getString("requestId"));check(peer!=null,"Missing forward");channels++;handed=true;workers.execute(()->pipe(s,peer));workers.execute(()->pipe(peer,s));}
    }catch(Exception ignored){}finally{if(!handed)close(s);}}
    void pipe(Socket a,Socket b){try{byte[] buffer=new byte[32768];int n;while((n=a.getInputStream().read(buffer))!=-1){b.getOutputStream().write(buffer,0,n);b.getOutputStream().flush();}}catch(Exception ignored){}finally{close(a);close(b);}}
    void close(Socket s){if(s!=null){sockets.remove(s);try{s.close();}catch(Exception ignored){}}}
    public void close(){try{listener.close();}catch(Exception ignored){}for(Socket s:sockets)close(s);workers.shutdownNow();}
  }
}
