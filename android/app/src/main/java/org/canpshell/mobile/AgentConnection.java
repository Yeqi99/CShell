package org.canpshell.mobile;

import org.json.*;
import javax.net.ssl.*;
import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.cert.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Agent protocol v1: one pinned mutual-TLS stream, bounded frames and explicit terminal flow control. */
final class AgentConnection implements AutoCloseable {
  interface Trust { boolean verify(byte[] certificate); }
  interface Events { void emit(String type, String value); }
  private final Events events;
  private final AtomicBoolean closed = new AtomicBoolean();
  private final Map<String,CompletableFuture<JSONObject>> pending = new ConcurrentHashMap<>();
  private final Map<String,ScheduledFuture<?>> commands = new ConcurrentHashMap<>();
  private final Object acknowledgementLock = new Object();
  private long renderedCharacters;
  private String acknowledgementRequest;
  private boolean acknowledgementScheduled;
  private final BlockingQueue<Integer> acknowledgements = new ArrayBlockingQueue<>(256);
  private final ExecutorService writer = new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(128));
  private final ScheduledExecutorService heartbeat = Executors.newSingleThreadScheduledExecutor();
  private volatile SSLSocket socket;
  private JSONArray environments = new JSONArray();
  private volatile boolean opened;
  private volatile DesktopTransport desktop;
  private String deviceId;
  String browserIdentity(){return deviceId;}
  Object manage(String method, Object params)throws Exception { return requestValue("manage",new JSONObject().put("method",method).put("params",params)); }
  void desktop(JSONObject quality,boolean control)throws Exception {
    JSONObject ticket=(JSONObject)manage("desktop.open",new JSONObject().put("quality",quality).put("control",control).put("transport","management").put("mediaTransport","tcp"));
    if(!deviceId.equals(ticket.getString("hostIdentity"))||ticket.getLong("expiresAt")<=System.currentTimeMillis())throw new IOException("桌面身份或票据无效");
    desktop=new DesktopTransport(ticket,events);
    socket.setSoTimeout(15000);
    heartbeat.shutdownNow();
    requestValue("desktop-stream",null);
  }
  void desktopCommand(String json)throws Exception { DesktopTransport d=desktop;if(d!=null)d.command(new JSONObject(json)); }
  void queueDesktopCommand(String json){execute(()->desktopCommand(json));}
  private final Object outputLock = new Object();
  private final List<String> earlyOutput = new ArrayList<>();
  private int earlySize;
  AgentConnection(Events events) { this.events = events; }
  void connect(String host, int port, String password, Trust trust) throws Exception {
    if(closed.get())throw new IOException("连接已取消");
    if (android.os.Build.VERSION.SDK_INT < 29) throw new IOException("Agent 连接需要 Android 10 或更新版本（TLS 1.3）");
    SSLContext context = SSLContext.getInstance("TLSv1.3");
    context.init(AgentIdentity.managers(), new TrustManager[]{new X509TrustManager() {
      public X509Certificate[] getAcceptedIssuers(){return new X509Certificate[0];}
      public void checkClientTrusted(X509Certificate[] chain,String type)throws CertificateException{throw new CertificateException("Client trust unavailable");}
      public void checkServerTrusted(X509Certificate[] chain,String type)throws CertificateException{
        if(chain.length==0)throw new CertificateException("Missing Agent identity"); chain[0].checkValidity();
        // Exact persisted leaf pin / human confirmation is checked before application traffic below.
      }
    }},null);
    SSLSocket s=(SSLSocket)context.getSocketFactory().createSocket(); socket=s;
    if(closed.get()){s.close();throw new IOException("连接已取消");}
    s.setEnabledProtocols(new String[]{"TLSv1.3"});s.connect(new InetSocketAddress(host,port),10000);s.setSoTimeout(10000);s.startHandshake();
    byte[] certificate=s.getSession().getPeerCertificates()[0].getEncoded();
    if(!trust.verify(certificate)||closed.get())throw new IOException("Agent 身份未获信任或连接已取消");
    s.setSoTimeout(0);
    Thread reader=new Thread(this::read,"cshell-agent-reader");reader.setDaemon(true);reader.start();
    JSONObject info=request("info",null);
    if(info.getInt("protocol")!=1)throw new IOException("不支持的 Agent 协议");UUID.fromString(info.getString("deviceId"));
    JSONObject credentials=new JSONObject().put("name","CShell Android");
    if(!password.isEmpty())credentials.put("password",password);
    JSONObject auth=request("auth",credentials);
    if(auth.getInt("protocol")!=1||!info.getString("deviceId").equals(auth.getString("deviceId")))throw new IOException("Agent 身份不匹配");
    deviceId=info.getString("deviceId");
    JSONArray allowed=auth.getJSONArray("shells");
    try {
      Object result=requestValue("manage",new JSONObject().put("method","agent.shells"));
      if(!(result instanceof JSONArray))throw new IOException("Invalid Agent environments");
      JSONArray candidates=(JSONArray)result;
      for(int i=0;i<candidates.length()&&i<100;i++){
        JSONObject item=candidates.getJSONObject(i);String shell=item.getString("shell");
        if(!contains(allowed,shell)||!Arrays.asList("cmd","powershell","bash","zsh","sh","wsl").contains(shell))continue;
        String distribution=item.optString("distribution");if(shell.equals("wsl")&&(distribution.isEmpty()||distribution.length()>100))continue;
        environments.put(new JSONObject().put("shell",shell).put("distribution",distribution).put("label",item.optString("label",shell)));
      }
    } catch(AgentDenied legacy) {
      for(int i=0;i<allowed.length();i++){
        String shell=allowed.getString(i);if(Arrays.asList("cmd","powershell","bash","zsh","sh").contains(shell))environments.put(new JSONObject().put("shell",shell).put("label",shell));
      }
    }
    try { events.emit("desktop-status",manage("desktop.status",new JSONObject()).toString()); } catch(AgentDenied unavailable) { events.emit("desktop-status","{}"); }
    heartbeat.scheduleAtFixedRate(()->{try{request("ping",null);}catch(Exception e){fail(e);}},15,15,TimeUnit.SECONDS);
    events.emit("environments",environments.toString());
    JSONObject apps=new JSONObject();
    try{JSONObject browser=(JSONObject)manage("browser.status",new JSONObject());apps.put("browser",browser.optBoolean("available"));}catch(AgentDenied unavailable){}
    try{JSONObject ide=(JSONObject)manage("ide.status",new JSONObject());apps.put("ide",ide.optBoolean("supported")&&ide.optBoolean("ready"));if(ide.optBoolean("supported"))apps.put("market",true);}catch(AgentDenied unavailable){}
    try{JSONObject coding=(JSONObject)manage("coding.status",new JSONObject());if(coding.optBoolean("supported"))apps.put("market",true);JSONArray engines=coding.optJSONArray("engines");if(engines!=null)for(int i=0;i<engines.length();i++){JSONObject e=engines.getJSONObject(i);apps.put(e.getString("engine"),e.optBoolean("ready"));}}catch(AgentDenied unavailable){}
    events.emit("machine-apps",apps.toString());
  }
  private static boolean contains(JSONArray values,String value)throws JSONException{for(int i=0;i<values.length();i++)if(value.equals(values.getString(i)))return true;return false;}
  synchronized void open(int index)throws Exception {
    if(opened||index<0||index>=environments.length())throw new IOException("终端环境无效");
    JSONObject selected=environments.getJSONObject(index);String shell=selected.getString("shell");
    Object payload=shell.equals("wsl")?new JSONObject().put("shell",shell).put("distribution",selected.getString("distribution")):shell;
    request("open",payload);
    synchronized(outputLock) { opened=true; events.emit("connected",selected.optString("label",shell)); for(String data:earlyOutput)emitData(data);earlyOutput.clear();earlySize=0; }
  }
  void input(String text){execute(()->{for(int start=0;start<text.length();){int end=Math.min(start+16384,text.length());if(end<text.length()&&Character.isHighSurrogate(text.charAt(end-1)))end--;command("input",text.substring(start,end));start=end;}});}
  void resize(int cols,int rows){if(cols>=2&&cols<=500&&rows>=1&&rows<=300)execute(()->command("resize",new JSONObject().put("cols",cols).put("rows",rows)));}
  void acknowledge() {
    Integer count=acknowledgements.poll();
    if(count==null || closed.get())return;
    synchronized(acknowledgementLock) { renderedCharacters+=count; }
    scheduleAcknowledgement();
  }
  // Rendering callbacks coalesce into one bounded request, rather than a request per data frame.
  private void scheduleAcknowledgement() {
    synchronized(acknowledgementLock) {
      if(closed.get() || renderedCharacters==0 || acknowledgementRequest!=null || acknowledgementScheduled)return;
      acknowledgementScheduled=true;
    }
    execute(this::flushAcknowledgement);
  }
  private void flushAcknowledgement() throws Exception {
    final int count; final String id=UUID.randomUUID().toString();
    synchronized(acknowledgementLock) {
      acknowledgementScheduled=false;
      if(closed.get() || renderedCharacters==0 || acknowledgementRequest!=null)return;
      // Other replies will retry draining; never disconnect simply because the window is full.
      if(commands.size()+pending.size()>=63)return;
      count=(int)Math.min(renderedCharacters,1048576L);
      renderedCharacters-=count;
      acknowledgementRequest=id;
    }
    command(id,"ack",count);
  }
  private void acknowledgementReplied(String id) {
    synchronized(acknowledgementLock) { if(id.equals(acknowledgementRequest))acknowledgementRequest=null; }
    scheduleAcknowledgement();
  }
  interface Operation{void run()throws Exception;}
  private void execute(Operation operation){if(closed.get())return;try{writer.execute(()->{try{operation.run();}catch(Exception e){fail(e);}});}catch(RejectedExecutionException e){fail(new IOException("Agent 输入队列已满"));}}
  private void command(String op,Object payload)throws Exception { command(UUID.randomUUID().toString(),op,payload); }
  private void command(String id,String op,Object payload)throws Exception {
    if(closed.get()||commands.size()+pending.size()>=64)throw new IOException("Agent 请求积压");
    ScheduledFuture<?> timeout=heartbeat.schedule(()->{if(commands.remove(id)!=null)fail(new IOException("Agent 请求超时，未重复执行"));},15,TimeUnit.SECONDS);
    commands.put(id,timeout);
    try { write(id,op,payload); } catch(Exception e){commands.remove(id);timeout.cancel(false);throw e;}
  }
  private void write(String id,String op,Object payload)throws Exception {
    byte[] bytes=(new JSONObject().put("id",id).put("op",op).put("payload",payload).toString()+"\n").getBytes(StandardCharsets.UTF_8);
    if(bytes.length>131073)throw new IOException("Agent frame too large");
    synchronized(socket){socket.getOutputStream().write(bytes);socket.getOutputStream().flush();}
  }
  private JSONObject request(String op,Object payload)throws Exception{return (JSONObject)requestValue(op,payload);}
  private Object requestValue(String op,Object payload)throws Exception{
    if(closed.get()||pending.size()>=64)throw new IOException("Agent 已断开或忙碌");String id=UUID.randomUUID().toString();CompletableFuture<JSONObject> future=new CompletableFuture<>();pending.put(id,future);
    try{
      write(id,op,payload);
      JSONObject reply=future.get(30,TimeUnit.SECONDS);if(reply.has("error"))throw new AgentDenied(reply.optString("error"));return reply.get("result");
    }catch(TimeoutException e){close();throw new IOException("Agent 请求超时，未重复执行");}finally{pending.remove(id);scheduleAcknowledgement();}
  }
  private void read(){try(InputStream in=new BufferedInputStream(socket.getInputStream())){
    ByteArrayOutputStream frame=new ByteArrayOutputStream();int b;
    while(!closed.get()&&(b=in.read())!=-1){if(b!=10){if(frame.size()>=131072)throw new IOException("Agent frame exceeds limit");frame.write(b);continue;}
      String text=StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(frame.toByteArray())).toString();frame.reset();JSONObject message=new JSONObject(text);
      if(message.has("event")){
        String event=message.getString("event");if(event.equals("closed"))break;
        if(!event.equals("data"))throw new IOException("Invalid Agent event");String data=message.getString("data");if(data.length()>65536)throw new IOException("Agent terminal frame exceeds limit");
        synchronized(outputLock) { if(opened)emitData(data);else { earlySize+=data.length();if(earlySize>500000)throw new IOException("Agent early output limit");earlyOutput.add(data); } }
      }else{CompletableFuture<JSONObject> future=pending.get(message.getString("id"));if(future!=null)future.complete(message);else {ScheduledFuture<?> timer=commands.remove(message.getString("id"));if(timer!=null){timer.cancel(false);if(message.has("error"))throw new IOException(message.optString("error"));} acknowledgementReplied(message.getString("id"));}
        if(desktop!=null && message.optJSONObject("result")!=null && message.getJSONObject("result").optBoolean("desktopStream")){desktop.run(in,socket.getOutputStream());return;}
      }
    }
  }catch(Exception e){if(!closed.get())events.emit("error",e.getMessage()==null?"Agent 连接失败":e.getMessage());}finally{close();}}
  private void emitData(String data)throws Exception {
    // Only delivered frames need renderer receipts; early output must not block the open reply.
    if(!acknowledgements.offer(data.length(),30,TimeUnit.SECONDS))throw new IOException("终端渲染超时");
    if(!closed.get())events.emit("data",android.util.Base64.encodeToString(data.getBytes(StandardCharsets.UTF_8),android.util.Base64.NO_WRAP));
  }
  private void fail(Exception e){if(!closed.get())events.emit("error",e.getMessage()==null?"Agent 操作失败":e.getMessage());close();}
  public void close(){if(!closed.compareAndSet(false,true))return;heartbeat.shutdownNow();writer.shutdownNow();try{if(socket!=null)socket.close();}catch(IOException ignored){}for(CompletableFuture<JSONObject> future:pending.values())future.completeExceptionally(new IOException("Agent 已断开"));pending.clear();commands.clear();acknowledgements.clear();synchronized(acknowledgementLock){renderedCharacters=0;acknowledgementRequest=null;acknowledgementScheduled=false;}events.emit("closed","");}
  private static final class AgentDenied extends IOException{AgentDenied(String message){super(message);}}
}
