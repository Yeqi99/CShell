package org.canpshell.mobile;

import android.content.Context;
import org.json.*;
import javax.net.ssl.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.cert.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Runs the real embedded host and Android viewer over loopback TLS, without screen or input permissions. */
final class AndroidHostProtocolTest {
  private static final JSONObject QUALITY;
  static {try{QUALITY=new JSONObject("{\"fps\":30,\"bitrate\":2000000,\"adaptive\":false,\"display\":0}");}catch(Exception e){throw new ExceptionInInitializerError(e);}}
  static final class Capture implements AndroidAgentHost.Backend {
    final ScheduledExecutorService frames=Executors.newSingleThreadScheduledExecutor();
    volatile ScheduledFuture<?> delivery;volatile AndroidAgentHost.Events events;
    final AtomicInteger inputs=new AtomicInteger(),releases=new AtomicInteger();
    volatile boolean accessible=true,projecting=true;
    public boolean available(){return projecting;} public boolean controlAvailable(){return projecting&&accessible;}
    public String unavailableReason(){return "PROJECTION_STOPPED: 请在手机上重新授权屏幕共享";}
    public void start(JSONObject quality,AndroidAgentHost.Events e)throws Exception{
      events=e;e.video(new JSONObject().put("width",320).put("height",240).put("sourceWidth",320).put("sourceHeight",240).put("fps",30).put("codec","avc1.42001e").put("encoder","fixture").put("hardware",false));
      byte[] frame=new byte[100000];Arrays.fill(frame,(byte)73);
      delivery=frames.scheduleAtFixedRate(()->e.frame(frame,System.nanoTime()/1000,true),30,70,TimeUnit.MILLISECONDS);
    }
    public void stop(){ScheduledFuture<?> f=delivery;if(f!=null)f.cancel(false);delivery=null;events=null;}
    public void input(JSONObject event)throws IOException{if("key".equals(event.optString("kind"))&&event.optInt("code")==59)throw new IOException("Unsupported fixture key");inputs.incrementAndGet();}
    public void releaseInput(){releases.incrementAndGet();}
    public void requestKeyFrame(){} public void quality(JSONObject q){}
    void close(){stop();frames.shutdownNow();}
  }
  static String fixture(android.app.Instrumentation runner)throws Exception {
    Context context=runner.getTargetContext();Capture capture=new Capture();AndroidAgentHost host=new AndroidAgentHost(context,capture);
    File config=new File(context.getFilesDir(),"host-fixture.json"),receipt=new File(context.getFilesDir(),"host-fixture-result.json"),stop=new File(context.getFilesDir(),"host-fixture-stop");
    config.delete();receipt.delete();stop.delete();String password="interop-"+UUID.randomUUID();
    try {
      host.start(47841,password);JSONObject info=host.connectionInfo("127.0.0.1",47841).put("password",password);
      try(FileOutputStream out=new FileOutputStream(config)){out.write(info.toString().getBytes(StandardCharsets.UTF_8));}
      android.os.Bundle status=new android.os.Bundle();status.putString("stream","HOST_FIXTURE_READY");runner.sendStatus(0,status);
      long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(180);
      while(!stop.exists()&&System.nanoTime()<deadline){JSONObject result=new JSONObject().put("inputs",capture.inputs.get()).put("releases",capture.releases.get()).put("running",host.status().getBoolean("running")).put("error",host.status().optString("error"));try(FileOutputStream out=new FileOutputStream(receipt)){out.write(result.toString().getBytes(StandardCharsets.UTF_8));}Thread.sleep(200);}
      return "OK (Android host external interoperability fixture closed)";
    }finally{host.close();capture.close();config.delete();stop.delete();}
  }
  static String run(Context context)throws Exception {
    Capture capture=new Capture();AndroidAgentHost host=new AndroidAgentHost(context,capture);int port;
    try(ServerSocket reserve=new ServerSocket(0)){port=reserve.getLocalPort();}
    String password="fixture-"+UUID.randomUUID(),replacement="changed-"+UUID.randomUUID();
    try {
      host.start(port,password);
      JSONObject invitation=host.connectionInfo("127.0.0.1",port);
      check(!invitation.has("password")&&!invitation.has("keys"),"Invitation exposed credentials");
      AgentConnection denied=new AgentConnection((t,v)->{});
      try {boolean rejected=false;try{denied.connect("127.0.0.1",port,"wrong",cert->true);}catch(Exception expected){rejected=true;}check(rejected,"Wrong password accepted");}finally{denied.close();}
      for(int attempt=0;attempt<2;attempt++){
        final AgentConnection[] ref=new AgentConnection[1];CountDownLatch frames=new CountDownLatch(3);AtomicReference<Throwable> error=new AtomicReference<>();AtomicReference<JSONArray> shells=new AtomicReference<>();
        ref[0]=new AgentConnection((type,value)->{try{
          if(type.equals("environments"))shells.set(new JSONArray(value));
          if(type.equals("desktop-frame")){JSONObject frame=new JSONObject(value);byte[] data=android.util.Base64.decode(frame.getString("data"),android.util.Base64.DEFAULT);check(data.length==100000,"Fragment length mismatch");for(byte b:data)check(b==73,"AEAD body mismatch");ref[0].queueDesktopCommand(new JSONObject().put("op","ack").put("id",frame.getString("id")).toString());ref[0].queueDesktopCommand("{\"op\":\"input\",\"value\":{\"kind\":\"move\",\"x\":0.5,\"y\":0.5}}");frames.countDown();}
          if(type.equals("error")){error.set(new IOException(value));while(frames.getCount()>0)frames.countDown();}
        }catch(Throwable e){error.set(e);while(frames.getCount()>0)frames.countDown();}});
        try {
          ref[0].connect("127.0.0.1",port,attempt==0?password:"",cert->certificateMatches(cert,invitation.optString("certificate")));
          check(shells.get()!=null&&shells.get().length()==0,"Host advertised an unsupported terminal");
          JSONObject status=(JSONObject)ref[0].manage("desktop.status",new JSONObject());check(status.getBoolean("viewAllowed")&&status.getBoolean("controlAllowed"),"Real availability not reflected");
          ref[0].desktop(QUALITY,true);check(frames.await(15,TimeUnit.SECONDS),"Encrypted frame timeout");if(error.get()!=null)throw new Exception(error.get());Thread.sleep(150);
        }finally{ref[0].close();}
        long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);while(capture.delivery!=null&&System.nanoTime()<until)Thread.sleep(20);
      }
      check(capture.inputs.get()>0,"Control did not reach backend");check(capture.releases.get()>0,"Disconnect did not release input");
      // Losing projection must not invalidate pairing, the listener, or management access.
      capture.projecting=false;
      AgentConnection management=new AgentConnection((t,v)->{});
      try{
        management.connect("127.0.0.1",port,"",cert->certificateMatches(cert,invitation.optString("certificate")));
        check(((JSONObject)management.manage("client.status",new JSONObject())).getBoolean("running"),"Projection loss stopped management");
        JSONObject paused=(JSONObject)management.manage("desktop.status",new JSONObject());
        check(!paused.getBoolean("viewAllowed")&&!paused.getBoolean("controlAllowed"),"Stopped projection still advertised control");
        JSONObject installed=((JSONArray)management.manage("packages.list",new JSONObject())).getJSONObject(0);
        check(installed.getBoolean("registered")&&"not-configured".equals(installed.getString("status")),"Projection loss was reported as uninstalled");
        boolean rejected=false;try{management.manage("desktop.open",new JSONObject().put("quality",QUALITY).put("control",true).put("transport","management"));}catch(Exception expected){rejected=expected.getMessage().contains("PROJECTION_STOPPED");}
        check(rejected,"Stopped projection did not provide a recoverable error");
        capture.projecting=true;
        check(((JSONObject)management.manage("desktop.status",new JSONObject())).getBoolean("viewAllowed"),"Fresh projection did not restore availability");
      }finally{management.close();capture.projecting=true;}
      JSONObject stale;
      try(SSLSocket socket=connect(port)){InputStream in=socket.getInputStream();OutputStream out=socket.getOutputStream();rpc(in,out,"auth",new JSONObject().put("name","fixture"));stale=(JSONObject)rpc(in,out,"manage",new JSONObject().put("method","desktop.open").put("params",new JSONObject().put("quality",QUALITY).put("control",false).put("transport","management").put("mediaTransport","tcp")));}
      host.stop();host.start(port,password);
      check(invitation.getString("deviceId").equals(host.connectionInfo("127.0.0.1",port).getString("deviceId")),"Identity changed after restart");
      try(SSLSocket socket=connect(port)){InputStream in=socket.getInputStream();OutputStream out=socket.getOutputStream();rpc(in,out,"auth",new JSONObject().put("name","fixture"));rpc(in,out,"desktop-stream",null);JSONObject hello=AndroidAgentHost.line(in,4096);AndroidAgentHost.writeLine(out,new JSONObject().put("id",stale.getString("id")).put("proof",AndroidAgentHost.hex(AndroidAgentHost.hmac(DesktopTransport.hex(stale.getJSONObject("keys").getString("bootstrap")),"client:"+hello.getString("nonce")+":"+stale.getString("id")))));check(in.read()==-1,"Restart reused a stale desktop ticket");}
      // A valid controller cannot replay even its own authenticated control record.
      try(SSLSocket socket=connect(port)){
        InputStream in=socket.getInputStream();OutputStream out=socket.getOutputStream();rpc(in,out,"auth",new JSONObject().put("name","fixture"));
        JSONObject ticket=(JSONObject)rpc(in,out,"manage",new JSONObject().put("method","desktop.open").put("params",new JSONObject().put("quality",QUALITY).put("control",false).put("transport","management").put("mediaTransport","tcp")));
        rpc(in,out,"desktop-stream",null);JSONObject hello=AndroidAgentHost.line(in,4096);AndroidAgentHost.writeLine(out,new JSONObject().put("id",ticket.getString("id")).put("proof",AndroidAgentHost.hex(AndroidAgentHost.hmac(DesktopTransport.hex(ticket.getJSONObject("keys").getString("bootstrap")),"client:"+hello.getString("nonce")+":"+ticket.getString("id")))));AndroidAgentHost.line(in,4096);
        JSONObject greeting=new JSONObject().put("op","hello").put("identity",ticket.getString("owner")).put("generation",ticket.getString("generation")).put("port",0).put("transport","tcp");
        record(out,ticket,0,greeting);record(out,ticket,0,new JSONObject().put("op","ping").put("sent",1));
        int drained=0;while(in.read()!=-1){if(++drained>2000000)throw new AssertionError("Replay was not closed within bounded output");}
      }
      long settled=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);while(capture.delivery!=null&&System.nanoTime()<settled)Thread.sleep(20);
      host.stop();host.start(port,replacement);
      AgentConnection oldPeer=new AgentConnection((t,v)->{});boolean revoked=false;try{oldPeer.connect("127.0.0.1",port,"",cert->true);}catch(Exception expected){revoked=true;}finally{oldPeer.close();}check(revoked,"Changing password retained previous peer authorization");
      return "OK (Android host TLS 1.3, password rejection, 6 AEAD fragmented frames, input, pinned reconnect, stop ticket invalidation, replay rejection, password rotation)";
    } finally {host.close();capture.close();}
  }
  private static void record(OutputStream out,JSONObject ticket,long sequence,JSONObject message)throws Exception{
    byte[] seq=java.nio.ByteBuffer.allocate(8).putLong(sequence).array(),session=DesktopTransport.hex(ticket.getString("session"));
    byte[] data=AndroidAgentHost.crypt(true,DesktopTransport.hex(ticket.getJSONObject("keys").getString("viewerControl")),seq,java.nio.ByteBuffer.allocate(16).put(session).put(seq).array(),message.toString().getBytes(StandardCharsets.UTF_8));
    DataOutputStream stream=new DataOutputStream(out);stream.writeInt(8+data.length);stream.write(seq);stream.write(data);stream.flush();
  }
  private static boolean certificateMatches(byte[] der,String pem){try{byte[] expected=android.util.Base64.decode(pem.replace("-----BEGIN CERTIFICATE-----","").replace("-----END CERTIFICATE-----",""),android.util.Base64.DEFAULT);return java.security.MessageDigest.isEqual(der,expected);}catch(Exception e){return false;}}
  private static SSLSocket connect(int port)throws Exception {SSLContext context=SSLContext.getInstance("TLSv1.3");context.init(AgentIdentity.managers(),new TrustManager[]{new X509TrustManager(){public X509Certificate[] getAcceptedIssuers(){return new X509Certificate[0];}public void checkClientTrusted(X509Certificate[] c,String t){}public void checkServerTrusted(X509Certificate[] c,String t)throws CertificateException{if(c.length==0)throw new CertificateException();c[0].checkValidity();}}},null);SSLSocket socket=(SSLSocket)context.getSocketFactory().createSocket("127.0.0.1",port);socket.setEnabledProtocols(new String[]{"TLSv1.3"});socket.setSoTimeout(10000);socket.startHandshake();return socket;}
  private static Object rpc(InputStream in,OutputStream out,String op,Object payload)throws Exception{String id=UUID.randomUUID().toString();AndroidAgentHost.writeLine(out,new JSONObject().put("id",id).put("op",op).put("payload",payload));JSONObject value=AndroidAgentHost.line(in,131072);check(id.equals(value.getString("id")),"RPC identity mismatch");if(value.has("error"))throw new IOException(value.getString("error"));return value.get("result");}
  private static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
}
