package org.canpshell.mobile;

import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.Set;
import java.util.concurrent.*;
import javax.net.ssl.*;

/** Outbound rendezvous only: target TLS and password pairing still terminate in AndroidAgentHost. */
final class AndroidAccountRelay implements AutoCloseable {
  interface Enrollment { JSONObject enroll() throws Exception; }
  private final Enrollment enrollment;
  private final int localPort;
  private final ScheduledExecutorService schedule=Executors.newScheduledThreadPool(2);
  private final ExecutorService channels=new ThreadPoolExecutor(0,16,15,TimeUnit.SECONDS,new SynchronousQueue<>());
  private final Set<Socket> sockets=ConcurrentHashMap.newKeySet();
  private volatile boolean closed,connected;
  private volatile String error="";
  private volatile JSONObject config;
  private volatile Socket control;
  AndroidAccountRelay(int localPort,Enrollment enrollment){this.localPort=localPort;this.enrollment=enrollment;}
  void start(){schedule.scheduleWithFixedDelay(this::refresh,0,30,TimeUnit.SECONDS);schedule.scheduleWithFixedDelay(this::heartbeat,20,20,TimeUnit.SECONDS);}
  JSONObject status()throws Exception{return new JSONObject().put("connected",connected).put("registered",config!=null).put("error",error);}
  private synchronized void refresh(){
    if(closed)return;
    try{
      JSONObject next=enrollment.enroll();if(closed)return;
      if(next==null){disconnect();config=null;return;}
      if(config!=null&&!config.toString().equals(next.toString()))disconnect();config=next;
      if(control==null){final JSONObject session=new JSONObject(next.toString());final SSLSocket socket=open(session,"register",null);if(closed){socket.close();return;}control=socket;connected=true;error="";
        channels.execute(()->listen(socket,session));}
    }catch(Exception e){error="账号设备连接暂不可用";disconnect();}
  }
  private void heartbeat(){Socket s=control;if(s!=null)try{write(s,new JSONObject().put("type","ping"));}catch(Exception e){disconnect(s);}}
  private void listen(SSLSocket socket,JSONObject session){
    try{socket.setSoTimeout(60000);while(!closed&&control==socket){JSONObject m=line(socket.getInputStream());String type=m.optString("type");if(type.equals("pong"))continue;String id=m.optString("requestId");if(!type.equals("open")||!id.matches("[a-f0-9]{64}"))throw new IOException("Invalid relay control");
      try{channels.execute(()->channel(socket,session,id));}catch(RejectedExecutionException e){write(socket,new JSONObject().put("type","reject").put("requestId",id));}
    }}catch(Exception ignored){}finally{disconnect(socket);}
  }
  private void channel(Socket parent,JSONObject session,String id){
    Socket remote=null,local=null;
    try{if(closed||control!=parent)return;remote=open(session,"channel",id);local=new Socket();sockets.add(local);local.connect(new InetSocketAddress("127.0.0.1",localPort),10000);local.setSoTimeout(60000);remote.setSoTimeout(60000);
      if(closed||control!=parent)throw new IOException("Relay ended");final Socket a=remote,b=local;
      channels.execute(()->{try{copy(a,b);}catch(Exception ignored){}finally{closeSocket(a);closeSocket(b);}});
      copy(b,a);
    }catch(Exception ignored){try{write(parent,new JSONObject().put("type","reject").put("requestId",id));}catch(Exception e){}}
    finally{closeSocket(remote);closeSocket(local);}
  }
  private static void copy(Socket from,Socket to)throws Exception{byte[] bytes=new byte[32768];int n;InputStream in=from.getInputStream();OutputStream out=to.getOutputStream();while((n=in.read(bytes))!=-1){out.write(bytes,0,n);out.flush();}}
  private SSLSocket open(JSONObject endpoint,String operation,String requestId)throws Exception{
    String pin=endpoint.getString("fingerprint").replace(":","").toLowerCase(java.util.Locale.ROOT);
    if(!pin.matches("[a-f0-9]{64}"))throw new IOException("Relay identity required");
    SSLContext tls=SSLContext.getInstance("TLS");tls.init(null,new TrustManager[]{new X509TrustManager(){
      public X509Certificate[] getAcceptedIssuers(){return new X509Certificate[0];}
      public void checkClientTrusted(X509Certificate[] c,String a)throws java.security.cert.CertificateException{throw new java.security.cert.CertificateException();}
      public void checkServerTrusted(X509Certificate[] c,String a)throws java.security.cert.CertificateException{try{if(c.length==0||!pin.equals(AndroidHostIdentity.fingerprint(c[0].getEncoded()).replace(":","").toLowerCase(java.util.Locale.ROOT)))throw new Exception();c[0].checkValidity();}catch(Exception e){throw new java.security.cert.CertificateException("Relay identity mismatch");}}
    }},new SecureRandom());
    SSLSocket s=(SSLSocket)tls.getSocketFactory().createSocket();sockets.add(s);
    try{if(closed)throw new IOException("Stopped");s.connect(new InetSocketAddress(endpoint.getString("host"),endpoint.getInt("port")),10000);s.setSoTimeout(10000);s.startHandshake();
      JSONObject request=new JSONObject().put("protocol","cshell-relay/1").put("operation",operation).put("targetId",endpoint.getString("targetId")).put("credential",endpoint.getString("credential"));if(requestId!=null)request.put("requestId",requestId);
      write(s,request);if(!line(s.getInputStream()).optBoolean("ok"))throw new IOException("Relay refused");return s;
    }catch(Exception e){closeSocket(s);throw e;}
  }
  private static void write(Socket s,JSONObject value)throws Exception{synchronized(s){s.getOutputStream().write((value.toString()+"\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));s.getOutputStream().flush();}}
  private static JSONObject line(InputStream in)throws Exception{ByteArrayOutputStream bytes=new ByteArrayOutputStream();int c;while((c=in.read())!=-1){if(c==10)return new JSONObject(bytes.toString("UTF-8"));if(bytes.size()>=8192)throw new IOException("Relay control limit");bytes.write(c);}throw new EOFException();}
  private void closeSocket(Socket s){if(s!=null){sockets.remove(s);try{s.close();}catch(Exception ignored){}}}
  private synchronized void disconnect(Socket expected){if(control==expected)disconnect();}
  private void disconnect(){control=null;connected=false;for(Socket s:sockets)closeSocket(s);}
  public void close(){closed=true;disconnect();schedule.shutdownNow();channels.shutdownNow();}
}
