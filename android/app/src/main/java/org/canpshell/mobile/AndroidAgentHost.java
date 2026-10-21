package org.canpshell.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.*;
import javax.net.ssl.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import java.io.*;
import java.net.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.cert.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Embedded Android CAgent host. Only explicitly implemented capabilities are advertised.
 * TLS 1.3 + pinned identities precede password pairing; desktop v1 uses fresh directional AEAD keys.
 * One desktop consumer, bounded clients/frames, and no terminal or broad filesystem emulation. */
final class AndroidAgentHost implements AutoCloseable {
  interface Events { void video(JSONObject info); void frame(byte[] annexB,long timestampUs,boolean key); void error(String reason); }
  interface Backend {
    boolean available(); boolean controlAvailable();
    default String unavailableReason(){return "请在手机上开始屏幕共享并确认系统授权";}
    void start(JSONObject quality,Events events)throws Exception;
    void stop(); void input(JSONObject event)throws Exception; void releaseInput();
    void requestKeyFrame(); void quality(JSONObject quality)throws Exception;
  }
  private final Backend backend;
  private final AndroidHostIdentity identity;
  private final SharedPreferences prefs;
  private final Set<SSLSocket> sockets=ConcurrentHashMap.newKeySet();
  private final Map<String,JSONObject> pending=new HashMap<>();
  private final ArrayDeque<Long> attempts=new ArrayDeque<>();
  private final SecureRandom random=new SecureRandom();
  private volatile SSLServerSocket listener;
  private volatile ThreadPoolExecutor clients;
  private volatile ScheduledExecutorService timer;
  private volatile Desktop desktop;
  private volatile byte[] passwordDigest; private byte[] passwordSalt;
  private volatile String failure="";
  private final AtomicLong epoch=new AtomicLong();
  AndroidAgentHost(Context context,Backend backend)throws Exception {this.backend=backend;identity=new AndroidHostIdentity(context);prefs=context.getSharedPreferences("cagent-host-peers",0);}
  synchronized void start(int port,String password)throws Exception {
    if(android.os.Build.VERSION.SDK_INT<29)throw new IOException("CAgent host requires Android 10 or newer");
    if(port<1024||port>65535||password==null||password.length()<1||password.length()>128)throw new IOException("Invalid CAgent port or password");
    stop();failure="";
    String salt=prefs.getString("passwordSalt",null); if(salt==null)salt=secret(16); passwordSalt=DesktopTransport.hex(salt); byte[] digest=passwordHash(password);
    String marker=hex(digest);
    if(!marker.equals(prefs.getString("passwordMarker",""))){if(!prefs.edit().clear().putString("passwordSalt",salt).putString("passwordMarker",marker).commit())throw new IOException("Cannot persist pairing state");}
    passwordDigest=digest;
    SSLContext tls=SSLContext.getInstance("TLSv1.3");
    tls.init(identity.managers,new TrustManager[]{new X509TrustManager(){
      public X509Certificate[] getAcceptedIssuers(){return new X509Certificate[0];}
      public void checkServerTrusted(X509Certificate[] chain,String type)throws CertificateException{throw new CertificateException("Host only");}
      public void checkClientTrusted(X509Certificate[] chain,String type)throws CertificateException {if(chain.length==0)throw new CertificateException("Missing controller identity");chain[0].checkValidity();}
    }},random);
    SSLServerSocket server=(SSLServerSocket)tls.getServerSocketFactory().createServerSocket();server.setReuseAddress(true);server.setEnabledProtocols(new String[]{"TLSv1.3"});server.setNeedClientAuth(true);server.bind(new InetSocketAddress("0.0.0.0",port),8);
    listener=server;long generation=epoch.incrementAndGet();
    clients=new ThreadPoolExecutor(0,8,15,TimeUnit.SECONDS,new SynchronousQueue<>());
    timer=Executors.newSingleThreadScheduledExecutor();
    Thread accept=new Thread(()->{while(listener==server&&!server.isClosed()){try{SSLSocket s=(SSLSocket)server.accept();sockets.add(s);try{clients.execute(()->serve(s,generation));}catch(RejectedExecutionException e){sockets.remove(s);s.close();}}catch(Exception e){if(listener==server)failure="CAgent listener stopped";break;}}},"cagent-host-listener");accept.setDaemon(true);accept.start();
  }
  JSONObject status()throws JSONException{return new JSONObject().put("running",listener!=null&&!listener.isClosed()).put("deviceId",identity.id).put("port",listener==null?0:listener.getLocalPort()).put("bind","0.0.0.0").put("sharing",backend.available()).put("accessibilityEnabled",backend.controlAvailable()).put("connections",sockets.size()).put("error",failure);}
  JSONObject connectionInfo(String host,int port)throws Exception {if(host==null||!host.matches("[a-zA-Z0-9.:-]{1,253}")||port<1||port>65535)throw new IOException("Invalid public endpoint");return new JSONObject().put("protocol",1).put("deviceId",identity.id).put("name",name()).put("certificate",identity.pem()).put("host",host).put("port",port);}
  private String name(){return (android.os.Build.MANUFACTURER+" "+android.os.Build.MODEL).trim();}
  synchronized void stop(){epoch.incrementAndGet();SSLServerSocket old=listener;listener=null;try{if(old!=null)old.close();}catch(IOException ignored){}Desktop d=desktop;if(d!=null)d.close();for(SSLSocket s:sockets)try{s.close();}catch(IOException ignored){}sockets.clear();pending.clear();if(clients!=null)clients.shutdownNow();if(timer!=null)timer.shutdownNow();passwordDigest=null;backend.releaseInput();}
  public void close(){stop();}
  private void serve(SSLSocket socket,long generation){
    try {socket.setSoTimeout(10000);socket.setTcpNoDelay(true);socket.startHandshake();String owner=AndroidHostIdentity.fingerprint(socket.getSession().getPeerCertificates()[0].getEncoded());boolean authenticated=false;InputStream in=new BufferedInputStream(socket.getInputStream());OutputStream out=socket.getOutputStream();
      while(epoch.get()==generation&&!socket.isClosed()){
        JSONObject request=line(in,131072);String id=request.getString("id"),op=request.getString("op");if(id.length()>128)throw new IOException("Request identity length");Object result;
        try {
          if(op.equals("info")&&!authenticated)result=new JSONObject().put("protocol",1).put("deviceId",identity.id).put("name",name());
          else if(op.equals("auth")&&!authenticated){JSONObject p=request.getJSONObject("payload");pair(owner,p,generation);authenticated=true;result=new JSONObject().put("protocol",1).put("deviceId",identity.id).put("shells",new JSONArray()).put("capabilities",new JSONArray().put("agent.manage"));socket.setSoTimeout(45000);}
          else {if(!authenticated||!prefs.getBoolean("peer."+owner,false)||epoch.get()!=generation)throw new IOException("CAgent authentication required");
            if(op.equals("ping"))result=new JSONObject();
            else if(op.equals("manage")){JSONObject p=request.getJSONObject("payload");result=manage(owner,p.getString("method"),p.optJSONObject("params"));}
            else if(op.equals("desktop-stream")){writeLine(out,new JSONObject().put("id",id).put("result",new JSONObject().put("desktopStream",true)));new Desktop(socket,in,out,owner,generation).run();return;}
            else throw new IOException("Operation is not supported by Android CAgent");
          }
          writeLine(out,new JSONObject().put("id",id).put("result",result));
        }catch(Exception e){writeLine(out,new JSONObject().put("id",id).put("error",safe(e)));if(!authenticated)return;}
      }
    }catch(Exception ignored){}finally{sockets.remove(socket);try{socket.close();}catch(IOException ignored){}}
  }
  private synchronized void pair(String owner,JSONObject payload,long generation)throws Exception {
    if(epoch.get()!=generation)throw new IOException("CAgent restarted");if(prefs.getBoolean("peer."+owner,false))return;
    long now=System.currentTimeMillis();while(!attempts.isEmpty()&&now-attempts.peekFirst()>60000)attempts.removeFirst();if(attempts.size()>=5)throw new IOException("Authentication rate limited; retry in a minute");attempts.addLast(now);
    String password=payload.optString("password","");if(password.length()<1||password.length()>128||passwordDigest==null||!MessageDigest.isEqual(passwordDigest,passwordHash(password)))throw new IOException("CAgent authentication failed");
    if(prefs.getAll().size()>32)throw new IOException("Controller limit reached");if(!prefs.edit().putBoolean("peer."+owner,true).commit())throw new IOException("Could not save controller");
  }
  private synchronized Object manage(String owner,String method,JSONObject params)throws Exception {
    if(params==null)params=new JSONObject();
    switch(method){
      case "agent.shells":case "agent.environments":case "packages.tools":case "applications.list":case "agent.logs":return new JSONArray();
      case "client.status":return new JSONObject().put("running",listener!=null&&!listener.isClosed()).put("deviceId",identity.id).put("fingerprint",AndroidHostIdentity.fingerprint(identity.certificate.getEncoded())).put("port",listener==null?0:listener.getLocalPort()).put("bind","0.0.0.0").put("platform","android").put("passwordConfigured",true).put("allowedShells",new JSONArray()).put("allowManage",true).put("allowHttp",false).put("allowHosting",false).put("allowRelay",false).put("peers",new JSONArray()).put("audit",new JSONArray());
      case "packages.list":return new JSONArray().put(new JSONObject().put("id","cagent.desktop").put("name","Android 屏幕共享").put("version","0.1.0").put("registered",true).put("status",backend.available()?"ready":"not-configured").put("reason",backend.available()?"":backend.unavailableReason()).put("grants",new JSONArray().put("desktop.view").put("desktop.control")));
      case "packages.catalog":return new JSONArray();
      case "desktop.status":return new JSONObject().put("enabled",true).put("listening",listener!=null).put("viewAllowed",backend.available()).put("controlAllowed",backend.available()&&backend.controlAvailable()).put("busy",desktop!=null).put("reason",backend.available()?"":backend.unavailableReason()).put("recoverable",!backend.available()).put("qualityModes",new JSONArray().put("bounded")).put("packageReady",true).put("nativeAvailable",true).put("inputFeatures",new JSONArray().put("unicode-text")).put("implementation","android-mediaprojection-mediacodec").put("relay",false).put("config",new JSONObject().put("enabled",true).put("authenticatedPeers",true).put("directListener",false));
      case "desktop.open":{
        if(!backend.available())throw new IOException(backend.unavailableReason());
        if(!"management".equals(params.optString("transport")))throw new IOException("Android desktop requires the authenticated management transport");
        if("udp".equals(params.optString("mediaTransport")))throw new IOException("Unsupported mediaTransport: udp; Android desktop requires TCP");
        JSONObject quality=params.getJSONObject("quality");validateQuality(quality);
        boolean control=params.optBoolean("control");if(control&&!backend.controlAvailable())throw new IOException("请先在手机系统设置中启用 CAgent 辅助控制");
        long now=System.currentTimeMillis();Iterator<JSONObject> iterator=pending.values().iterator();while(iterator.hasNext())if(iterator.next().getLong("expiresAt")<=now)iterator.remove();
        if(desktop!=null||!pending.isEmpty())throw new IOException("DESKTOP_SINGLE_SESSION_BUSY");
        JSONObject keys=new JSONObject();for(String key:new String[]{"hostControl","viewerControl","hostMedia","viewerMedia","bootstrap"})keys.put(key,secret(32));
        JSONObject ticket=new JSONObject().put("id",secret(16)).put("expiresAt",now+30000).put("hostIdentity",identity.id).put("owner",owner).put("generation",secret(16)).put("session",secret(8)).put("control",control).put("transport","management").put("mediaTransport","tcp").put("tcpPort",listener.getLocalPort()).put("localTcpPort",listener.getLocalPort()).put("udpPort",0).put("localUdpPort",0).put("keys",keys);
        pending.put(ticket.getString("id"),new JSONObject(ticket.toString()).put("quality",quality));return ticket;
      }
      case "desktop.close":{String id=params.getString("id");JSONObject p=pending.get(id);if(p!=null&&owner.equals(p.getString("owner")))pending.remove(id);else if(desktop!=null&&owner.equals(desktop.owner)&&id.equals(desktop.ticket.optString("id")))desktop.close();else throw new IOException("Desktop session not found");return new JSONObject().put("closed",true);}
      default:throw new IOException("This capability is not available on Android CAgent");
    }
  }
  private static void validateQuality(JSONObject q)throws Exception {for(String k:new String[]{"fps","bitrate"})if(!q.has(k)||q.getDouble(k)<1||q.getDouble(k)>Integer.MAX_VALUE||q.getDouble(k)!=q.getLong(k))throw new IOException("Invalid quality settings");if(q.optBoolean("unlimited"))throw new IOException("Unlimited quality is not yet supported on Android host");if(q.optInt("display",0)!=0)throw new IOException("Android supports the shared screen only");for(String k:new String[]{"width","height"})if(q.has(k)&&(q.getInt(k)<2||q.getInt(k)>32768))throw new IOException("Invalid output size");}
  private byte[] passwordHash(String password)throws Exception{PBEKeySpec spec=new PBEKeySpec(password.toCharArray(),passwordSalt,120000,256);try{return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();}finally{spec.clearPassword();}}
  private String secret(int size){byte[] b=new byte[size];random.nextBytes(b);return hex(b);}
  static String hex(byte[] b){StringBuilder s=new StringBuilder();for(byte v:b)s.append(String.format(Locale.ROOT,"%02x",v));return s.toString();}
  static JSONObject line(InputStream in,int max)throws Exception {ByteArrayOutputStream b=new ByteArrayOutputStream();int n;while((n=in.read())!=-1&&n!=10){if(b.size()>=max)throw new IOException("Request exceeds limit");b.write(n);}if(n<0)throw new EOFException();return new JSONObject(new String(b.toByteArray(),StandardCharsets.UTF_8));}
  static void writeLine(OutputStream out,JSONObject value)throws Exception {out.write((value.toString()+"\n").getBytes(StandardCharsets.UTF_8));out.flush();}
  private static String safe(Exception e){String s=e.getMessage();return s==null?"CAgent operation failed":s.substring(0,Math.min(s.length(),200));}

  private final class Desktop implements AutoCloseable,Events {
    final SSLSocket socket;final InputStream input;final DataOutputStream output;final String owner;final long hostEpoch;
    JSONObject ticket;byte[] session,txKey,rxKey,mediaKey;long tx,rx,mediaSequence,frameId,inputSequence,lastInputNotice;volatile long awaiting=-1,writeStarted,lastAck=System.nanoTime();volatile boolean ready,hasVideo;final AtomicBoolean closed=new AtomicBoolean();
    final ExecutorService writer=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(2));
    final AtomicBoolean frameQueued=new AtomicBoolean();volatile boolean needKey=true;
    ScheduledFuture<?> watchdog;
    Desktop(SSLSocket s,InputStream in,OutputStream out,String owner,long hostEpoch){socket=s;input=in;output=new DataOutputStream(out);this.owner=owner;this.hostEpoch=hostEpoch;}
    void run()throws Exception {
      try {
        socket.setSoTimeout(5000);String nonce=secret(32);writeLine(output,new JSONObject().put("version",1).put("nonce",nonce));JSONObject response=line(input,4096);
        synchronized(AndroidAgentHost.this){JSONObject t=pending.get(response.getString("id"));if(t==null||t.getLong("expiresAt")<=System.currentTimeMillis()||!owner.equals(t.getString("owner"))||desktop!=null||hostEpoch!=epoch.get())throw new IOException("Invalid desktop ticket");byte[] key=DesktopTransport.hex(t.getJSONObject("keys").getString("bootstrap"));if(!MessageDigest.isEqual(hmac(key,"client:"+nonce+":"+t.getString("id")),DesktopTransport.hex(response.getString("proof"))))throw new IOException("Desktop proof invalid");pending.remove(t.getString("id"));ticket=t;desktop=this;writeLine(output,new JSONObject().put("proof",hex(hmac(key,"server:"+nonce+":"+t.getString("id")))));}
        JSONObject keys=ticket.getJSONObject("keys");session=DesktopTransport.hex(ticket.getString("session"));txKey=DesktopTransport.hex(keys.getString("hostControl"));rxKey=DesktopTransport.hex(keys.getString("viewerControl"));mediaKey=DesktopTransport.hex(keys.getString("hostMedia"));
        send(new JSONObject().put("op","hello").put("identity",identity.id).put("generation",ticket.getString("generation")).put("port",0).put("transport","tcp"));
        watchdog=timer.scheduleAtFixedRate(()->{long now=System.nanoTime();if(hostEpoch!=epoch.get()||(writeStarted!=0&&now-writeStarted>TimeUnit.SECONDS.toNanos(5))||(awaiting>=0&&now-lastAck>TimeUnit.SECONDS.toNanos(15))){failure="DESKTOP_WATCHDOG";close();}},1,1,TimeUnit.SECONDS);
        DataInputStream in=new DataInputStream(input);
        while(!closed.get()){
          int length=in.readInt();if(length<25||length>8216)throw new IOException("Invalid desktop control length");byte[] bytes=new byte[length];in.readFully(bytes);byte[] seq=Arrays.copyOf(bytes,8);if(ByteBuffer.wrap(seq).getLong()!=rx)throw new IOException("Desktop control replay");JSONObject message=new JSONObject(new String(crypt(false,rxKey,seq,ByteBuffer.allocate(16).put(session).put(seq).array(),Arrays.copyOfRange(bytes,8,length)),StandardCharsets.UTF_8));rx++;handle(message);
        }
      }catch(Exception e){failure="DESKTOP_CONTROL_"+e.getClass().getSimpleName();throw e;}finally{close();}
    }
    void handle(JSONObject m)throws Exception {
      String op=m.getString("op");if(op.equals("hello")){if(ready||!owner.equals(m.getString("identity"))||!ticket.getString("generation").equals(m.getString("generation"))||m.getInt("port")!=0||!"tcp".equals(m.getString("transport")))throw new IOException("Desktop binding mismatch");ready=true;socket.setSoTimeout(15000);synchronized(AndroidAgentHost.this){if(closed.get()||desktop!=this||hostEpoch!=epoch.get())return;backend.start(ticket.getJSONObject("quality"),this);}return;}
      if(!ready)throw new IOException("Desktop handshake required");
      switch(op){
        case "ping":send(new JSONObject().put("op","pong").put("sent",m.opt("sent")));break;
        case "pong":break;
        case "ack":if(String.valueOf(awaiting).equals(m.getString("id"))){awaiting=-1;lastAck=System.nanoTime();}break;
        case "keyframe":needKey=true;backend.requestKeyFrame();break;
        case "release-input":backend.releaseInput();break;
        case "input":{JSONObject value=m.getJSONObject("value");if(!ticket.optBoolean("control")||!hasVideo)break;if(!backend.controlAvailable()){backend.releaseInput();ticket.put("control",false);send(new JSONObject().put("op","notice").put("value","INPUT_DISABLED: 手机辅助控制已关闭"));break;}if(value.getLong("generation")!=1||value.getLong("sequence")<=inputSequence)throw new IOException("Input ordering invalid");inputSequence=value.getLong("sequence");boolean unsupported=false;synchronized(AndroidAgentHost.this){if(closed.get()||desktop!=this||hostEpoch!=epoch.get())return;try{backend.input(value);}catch(Exception e){backend.releaseInput();unsupported=true;}}if(unsupported&&System.nanoTime()-lastInputNotice>TimeUnit.SECONDS.toNanos(2)){lastInputNotice=System.nanoTime();send(new JSONObject().put("op","notice").put("value","Android 当前界面不支持此输入操作；屏幕共享仍在继续。"));}break;}
        case "quality":{JSONObject q=m.getJSONObject("value");validateQuality(q);synchronized(AndroidAgentHost.this){if(closed.get()||desktop!=this||hostEpoch!=epoch.get())return;backend.quality(q);needKey=true;backend.requestKeyFrame();}break;}
        case "feedback":break; // Transport receipts bound the queue; device quality remains explicit.
        case "close":close();break;
        default:throw new IOException("Invalid desktop operation");
      }
    }
    private synchronized void send(JSONObject value)throws Exception {if(closed.get())return;byte[] body=value.toString().getBytes(StandardCharsets.UTF_8);if(body.length>8192||tx==Long.MAX_VALUE)throw new IOException("Control budget");byte[] seq=ByteBuffer.allocate(8).putLong(tx++).array();byte[] encrypted=crypt(true,txKey,seq,ByteBuffer.allocate(16).put(session).put(seq).array(),body);writeStarted=System.nanoTime();try{output.writeInt(8+encrypted.length);output.write(seq);output.write(encrypted);output.flush();}finally{writeStarted=0;}}
    public void video(JSONObject info){try{JSONObject snapshot=new JSONObject(info.toString());writer.execute(()->{try{send(new JSONObject().put("op","video").put("value",snapshot));hasVideo=true;}catch(Exception e){failure="DESKTOP_WRITE_"+e.getClass().getSimpleName();close();}});}catch(Exception e){close();}}
    public void frame(byte[] data,long time,boolean key){
      if(closed.get()||!ready||!hasVideo)return;if(data.length==0||data.length>32*1024*1024){error("CAPTURE_FRAME_BUDGET");return;}
      if(awaiting>=0||!frameQueued.compareAndSet(false,true)){needKey=true;return;}
      if(needKey&&!key){frameQueued.set(false);backend.requestKeyFrame();return;}
      needKey=false;byte[] copy=data.clone();try{writer.execute(()->{try{sendFrame(copy,time,key);}catch(Exception e){failure="DESKTOP_FRAME_"+e.getClass().getSimpleName();close();}finally{frameQueued.set(false);}});}catch(RejectedExecutionException e){frameQueued.set(false);close();}
    }
    private void sendFrame(byte[] data,long timestamp,boolean key)throws Exception {
      long id=frameId++;if(id>0xffffffffL)throw new IOException("Frame identity exhausted");int payload=16384-48,count=(data.length+payload-1)/payload;awaiting=id;lastAck=System.nanoTime();
      for(int i=0;i<count&&!closed.get();i++){
        byte[] header=ByteBuffer.allocate(32).put((byte)1).put((byte)(key?1:0)).put(session).putLong(mediaSequence++).putInt((int)id).putShort((short)i).putShort((short)count).array();for(int p=0;p<6;p++)header[31-p]=(byte)(timestamp>>>(p*8));
        byte[] encrypted=crypt(true,mediaKey,Arrays.copyOfRange(header,10,18),header,Arrays.copyOfRange(data,i*payload,Math.min(data.length,(i+1)*payload)));
        synchronized(this){writeStarted=System.nanoTime();try{output.writeInt(0x80000000|32+encrypted.length);output.write(header);output.write(encrypted);output.flush();}finally{writeStarted=0;}}
      }
    }
    public void error(String reason){failure=reason==null?"Screen capture stopped":reason;String message=failure.startsWith("SCREEN_LOCKED")?"手机已锁屏或息屏，请在手机上解锁后重新连接；管理连接仍可使用":"手机屏幕共享已结束，请在手机上重新授权共享后连接；管理连接仍可使用";try{send(new JSONObject().put("op","close").put("reason",message).put("code",failure.startsWith("SCREEN_LOCKED")?"SCREEN_LOCKED":"PROJECTION_STOPPED").put("recoverable",true));}catch(Exception ignored){}close();}
    public void close(){if(!closed.compareAndSet(false,true))return;try{socket.close();}catch(Exception ignored){}if(watchdog!=null)watchdog.cancel(false);writer.shutdownNow();synchronized(AndroidAgentHost.this){if(desktop==this){desktop=null;backend.releaseInput();backend.stop();}}}
  }
  static byte[] hmac(byte[] key,String value)throws Exception{Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(key,"HmacSHA256"));return mac.doFinal(value.getBytes(StandardCharsets.UTF_8));}
  static byte[] crypt(boolean encrypt,byte[] key,byte[] sequence,byte[] aad,byte[] body)throws Exception{byte[] nonce=new byte[12];System.arraycopy(sequence,0,nonce,4,8);Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(encrypt?Cipher.ENCRYPT_MODE:Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,nonce));c.updateAAD(aad);return c.doFinal(body);}
}
