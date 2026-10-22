package org.canpshell.mobile;

import android.app.Activity;
import android.content.Intent;
import org.json.JSONArray;
import android.app.AlertDialog;
import android.os.Bundle;
import android.webkit.*;
import android.net.Uri;
import android.util.Base64;
import com.jcraft.jsch.*;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.Security;
import java.util.*;
import java.util.concurrent.*;
import org.bouncycastle.jce.provider.BouncyCastleProvider;

/** Local-only UI bridge. No remote page or remote script can access this interface. */
public class MainActivity extends Activity {
  private WebView web;
  private MachineBrowser browser;
  private AppUpdates updates;
  private LocalFiles localFiles;
  private CloudSync cloud;
  private final java.util.concurrent.atomic.AtomicBoolean cloudBusy=new java.util.concurrent.atomic.AtomicBoolean();
  private final ExecutorService workers = Executors.newCachedThreadPool();
  private final Map<String, Connection> connections = new ConcurrentHashMap<>();
  private volatile boolean destroyed;
  private final android.content.BroadcastReceiver cagentEvents=new android.content.BroadcastReceiver(){
    @Override public void onReceive(android.content.Context context,Intent intent){event("","cagent-status",AndroidAgentService.status(MainActivity.this).toString());}
  };
  private final Object trustLock = new Object();
  private static class Connection {
    Session session; volatile SshAgentBridge bridge; ChannelShell shell; OutputStream output; AgentConnection agent, desktop; String agentEndpoint, agentHost, cloudAgentId; int agentPort;
    final ExecutorService files = Executors.newSingleThreadExecutor();
    final ExecutorService writer = Executors.newSingleThreadExecutor();
    final Semaphore outputSlots = new Semaphore(8);
    synchronized void close() { if(bridge!=null)bridge.close(); if (desktop != null) desktop.close(); desktop=null; if (agent != null) agent.close(); files.shutdownNow(); writer.shutdownNow(); outputSlots.release(8); if (shell != null) shell.disconnect(); if (session != null) session.disconnect(); }
  }
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    cloud=new CloudSync(this);
    androidx.core.content.ContextCompat.registerReceiver(this,cagentEvents,new android.content.IntentFilter(AndroidAgentService.CHANGED),androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);
    Security.removeProvider("BC"); Security.addProvider(new BouncyCastleProvider());
    web = new WebView(this);
    localFiles = new LocalFiles(this,
      value -> { if(!destroyed)web.evaluateJavascript("window.localFilesChanged("+JSONObject.quote(value.toString())+")",null); },
      value -> { if(!destroyed)web.evaluateJavascript("window.fileEvent("+JSONObject.quote(value.toString())+")",null); });
    updates = new AppUpdates(this, workers, value -> runOnUiThread(() -> {
      if (!destroyed) web.evaluateJavascript("window.updateEvent(" + JSONObject.quote(value) + ")", null);
    }));
    web.getSettings().setJavaScriptEnabled(true);
    web.getSettings().setDomStorageEnabled(true);
    web.getSettings().setAllowFileAccess(false);
    web.getSettings().setAllowContentAccess(false);
    web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    web.addJavascriptInterface(new Bridge(), "CShellNative");
    web.setWebViewClient(new WebViewClient() {
      @Override public void onPageFinished(WebView view,String url){if("https://cshell.local/index.html".equals(url))event("","cagent-status",AndroidAgentService.status(MainActivity.this).toString());}
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
      @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        String path = uri.getPath();
        if (!"https".equals(uri.getScheme()) || !"cshell.local".equals(uri.getHost()) || path == null || !Arrays.asList("/index.html", "/app.js", "/app.css", "/icon.png").contains(path))
          return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
        try {
          String mime = path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".png") ? "image/png" : "text/html";
          return new WebResourceResponse(mime, path.endsWith(".png") ? null : "UTF-8", getAssets().open(path.substring(1)));
        } catch (IOException e) { return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0])); }
      }
    });
    // Inset the WebView's layout bounds: WebView padding does not reliably inset its HTML viewport.
    android.widget.FrameLayout content = new android.widget.FrameLayout(this);
    content.addView(web, new android.widget.FrameLayout.LayoutParams(-1, -1));
    androidx.core.view.WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    setContentView(content);
    browser=new MachineBrowser(this,content,workers);
    androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
      androidx.core.graphics.Insets safe = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars() | androidx.core.view.WindowInsetsCompat.Type.displayCutout() | androidx.core.view.WindowInsetsCompat.Type.ime());
      view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
      return androidx.core.view.WindowInsetsCompat.CONSUMED;
    });
    androidx.core.view.ViewCompat.requestApplyInsets(content);
    web.loadUrl("https://cshell.local/index.html");
    if (android.os.Build.VERSION.SDK_INT >= 33) {
      getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
        android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::navigateBack);
    }
  }
  private void event(String id, String type, String value) {
    if (destroyed) return;
    runOnUiThread(() -> { if (!destroyed) web.evaluateJavascript("window.receive(" + JSONObject.quote(id) + "," + JSONObject.quote(type) + "," + JSONObject.quote(value) + ")", null); });
  }
  private boolean trust(String endpoint, byte[] key) { return trust(endpoint,key,()->!destroyed); }
  private boolean trust(String endpoint, byte[] key, java.util.function.BooleanSupplier valid) {
    try {
      if(!valid.getAsBoolean())return false;
      String fingerprint = "SHA256:" + Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(key), Base64.NO_WRAP | Base64.NO_PADDING);
      if(endpoint.startsWith("agent:")) { StringBuilder hex=new StringBuilder(); for(byte b:MessageDigest.getInstance("SHA-256").digest(key)) { if(hex.length()>0)hex.append(":");hex.append(String.format(Locale.ROOT,"%02X",b)); } fingerprint="SHA256:"+hex; }
      final String shownFingerprint=fingerprint;
      String stored = getSharedPreferences("hosts", MODE_PRIVATE).getString(endpoint, null);
      if (stored != null) return stored.equals(fingerprint);
      CountDownLatch answer = new CountDownLatch(1); boolean[] approved = {false};
      runOnUiThread(() -> {
        if (destroyed) { answer.countDown(); return; }
        new AlertDialog.Builder(this).setTitle("核对服务器指纹").setMessage(endpoint + "\n" + shownFingerprint)
          .setPositiveButton("信任并连接", (dialog, which) -> { approved[0] = true; answer.countDown(); })
          .setNegativeButton("取消", (dialog, which) -> answer.countDown()).setOnCancelListener(dialog -> answer.countDown()).show();
      });
      if (!answer.await(90, TimeUnit.SECONDS) || !approved[0] || destroyed) return false;
      synchronized(trustLock) { return valid.getAsBoolean() && getSharedPreferences("hosts", MODE_PRIVATE).edit().putString(endpoint, fingerprint).commit(); }
    } catch (Exception e) { return false; }
  }
  public class Bridge {
    @JavascriptInterface public void cloudRequest(String json){
      if(destroyed||json.length()>2*1024*1024)return;
      if(!cloudBusy.compareAndSet(false,true))return;
      workers.execute(()->{String request="";try{
        JSONObject input=new JSONObject(json);request=input.getString("request");UUID.fromString(request);
        JSONObject result=cloud.call(input);event("","cloud-result",new JSONObject().put("request",request).put("result",result).toString());
      }catch(Exception error){try{event("","cloud-result",new JSONObject().put("request",request).put("error",error instanceof javax.crypto.AEADBadTagException?"恢复密钥错误或密文校验失败":error.getMessage()).toString());}catch(Exception ignored){}}
      finally{cloudBusy.set(false);}});
    }
    @JavascriptInterface public String localFilesStatus(){return localFiles.status().toString();}
    @JavascriptInterface public void localFilesChoose(){runOnUiThread(()->{if(pendingTransfer==null)localFiles.choose();});}
    @JavascriptInterface public String cagentStatus(){return AndroidAgentService.status(MainActivity.this).toString();}
    @JavascriptInterface public String cagentConfigure(String json){return AndroidAgentService.configure(MainActivity.this,json).toString();}
    @JavascriptInterface public void cagentStop(){
      stopService(new Intent(MainActivity.this,AndroidAgentService.class));
      AndroidAgentService.starting(MainActivity.this,false,"");
    }
    @JavascriptInterface public void cagentAccessibility(){
      runOnUiThread(()->{try{startActivity(new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS));}catch(Exception e){AndroidAgentService.starting(MainActivity.this,false,"无法打开无障碍设置");}});
    }
    @JavascriptInterface public void cagentBackgroundSettings(){
      runOnUiThread(()->{
        try{startActivity(new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));}
        catch(Exception unavailable){try{startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())));}catch(Exception e){AndroidAgentService.starting(MainActivity.this,false,"无法打开系统后台运行设置");}}
      });
    }
    @JavascriptInterface public void cagentCopyConnection(){
      try{
        String value=AndroidAgentService.connection(MainActivity.this).toString(2);
        android.content.ClipboardManager clipboard=getSystemService(android.content.ClipboardManager.class);
        clipboard.setPrimaryClip(android.content.ClipData.newPlainText("CAgent 连接信息",value));
      }catch(Exception e){AndroidAgentService.starting(MainActivity.this,false,e.getMessage());}
    }
    @JavascriptInterface public void cagentStart(){runOnUiThread(()->{
      try{
        if(android.os.Build.VERSION.SDK_INT<29)throw new IllegalStateException("CAgent 受控端需要 Android 10 或更新版本");
        JSONObject status=AndroidAgentService.status(MainActivity.this);
        if(status.optBoolean("sharing")||status.optBoolean("starting"))return;
        JSONObject settings=AndroidAgentSettings.read(MainActivity.this);
        if(!settings.getBoolean("enabled")||settings.getString("password").isEmpty())throw new IllegalStateException("请先启用 CAgent 并保存连接密码");
        android.media.projection.MediaProjectionManager manager=getSystemService(android.media.projection.MediaProjectionManager.class);
        Intent consent=android.os.Build.VERSION.SDK_INT>=34
          ?manager.createScreenCaptureIntent(android.media.projection.MediaProjectionConfig.createConfigForDefaultDisplay())
          :manager.createScreenCaptureIntent();
        AndroidAgentService.starting(MainActivity.this,true,"");
        startActivityForResult(consent,7107);
      }catch(Exception e){AndroidAgentService.starting(MainActivity.this,false,e.getMessage());}
    });}
    @JavascriptInterface public void setTheme(boolean dark) {
      runOnUiThread(() -> {
        int color = android.graphics.Color.parseColor(dark ? "#141b24" : "#ffffff");
        web.setBackgroundColor(color);
        getWindow().setStatusBarColor(color); getWindow().setNavigationBarColor(color);
        if (android.os.Build.VERSION.SDK_INT >= 30) {
          int mask = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
          getWindow().getInsetsController().setSystemBarsAppearance(dark ? 0 : mask, mask);
        } else {
          web.setSystemUiVisibility(dark ? 0 : android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
      });
    }
    @JavascriptInterface public boolean browserSupported(){return MachineBrowser.supported();}
    @JavascriptInterface public void browserOpen(String id,String name,String url){Connection c=connections.get(id);if(c==null)return;runOnUiThread(()->{if(connections.get(id)!=c)return;if(c.bridge!=null)browser.openSsh(id,name,c.bridge.browserIdentity(),c.session,url);else if(c.agent!=null)browser.open(id,name,c.agent,url);});}
    @JavascriptInterface public void machineRequest(String json){if(destroyed||json.length()>131072)return;workers.execute(()->{String request="",id="";try{JSONObject p=new JSONObject(json);request=p.getString("request");UUID.fromString(request);id=p.getString("session");String method=p.getString("method");if(!method.matches("^(ide|coding)\\.[a-zA-Z.]+$"))throw new IOException("不支持的机器应用操作");Connection c=connections.get(id);if(c==null||(c.agent==null&&c.bridge==null))throw new IOException("机器连接已断开");Object result=c.bridge!=null?c.bridge.manage(method,p.opt("params")):c.agent.manage(method,p.opt("params"));event(id,"machine-result",new JSONObject().put("request",request).put("result",result).toString());}catch(Exception e){try{event(id,"machine-result",new JSONObject().put("request",request).put("error",e.getMessage()).toString());}catch(Exception ignored){}}});}
    @JavascriptInterface public boolean agentSupported() { return android.os.Build.VERSION.SDK_INT >= 29; }
    @JavascriptInterface public String version() { return updates.current(); }
    @JavascriptInterface public void checkUpdate() { updates.check(); }
    @JavascriptInterface public void installUpdate() { updates.install(); }
    @JavascriptInterface public void openUpdatePage() {
      runOnUiThread(() -> {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/Yeqi99/CShell/releases"))); }
        catch (android.content.ActivityNotFoundException e) { android.widget.Toast.makeText(MainActivity.this, "未找到可打开下载页的浏览器", android.widget.Toast.LENGTH_LONG).show(); }
      });
    }
    @JavascriptInterface public void connect(String json) {
      if (destroyed) return;
      try { if (json.length() > 131072) return; if ("agent".equals(new JSONObject(json).optString("protocol"))) { connectAgent(json); return; } } catch (Exception ignored) { return; }
      workers.execute(() -> {
        String id = ""; Connection c = new Connection();
        try {
          JSONObject p = new JSONObject(json); cloud.fillCredentials(p); id = p.getString("id"); UUID.fromString(id);
          String host = p.getString("host").trim(), user = p.getString("username").trim(); int port = p.getInt("port");
          if (host.isEmpty() || user.isEmpty() || host.length() > 255 || user.length() > 255 || host.matches(".*[\\s\\p{Cntrl}].*") || port < 1 || port > 65535 || connections.size() >= 12) throw new IOException("连接参数无效或连接数已满");
          if (connections.putIfAbsent(id, c) != null) throw new IOException("连接已存在");
          JSch jsch = new JSch(); final String endpoint = host.toLowerCase(Locale.ROOT) + ":" + port;
          jsch.setHostKeyRepository(new HostKeyRepository() {
            public int check(String h, byte[] key) { return trust(endpoint, key) ? OK : CHANGED; }
            public void add(HostKey key, UserInfo ui) {}
            public void remove(String h, String type) {}
            public void remove(String h, String type, byte[] key) {}
            public String getKnownHostsRepositoryID() { return "CShell verified hosts"; }
            public HostKey[] getHostKey() { return new HostKey[0]; }
            public HostKey[] getHostKey(String h, String type) { return new HostKey[0]; }
          });
          String privateKey = p.optString("privateKey");
          if (!privateKey.isEmpty()) jsch.addIdentity("session", privateKey.getBytes(StandardCharsets.UTF_8), null, p.optString("passphrase").getBytes(StandardCharsets.UTF_8));
          c.session = jsch.getSession(user, host, port);
          c.session.setPassword(p.optString("password"));
          c.session.setConfig("StrictHostKeyChecking", "yes");
          c.session.setConfig("PreferredAuthentications", privateKey.isEmpty() ? "password" : "publickey");
          c.session.setServerAliveInterval(15000); c.session.connect(20000);
          if (destroyed || connections.get(id) != c) throw new IOException("连接已取消");
          c.shell = (ChannelShell)c.session.openChannel("shell");
          c.shell.setPtyType("xterm-256color", 80, 24, 0, 0);
          InputStream input = c.shell.getInputStream(); c.output = c.shell.getOutputStream(); c.shell.connect(15000);
          event(id, "connected", ""); final String machineId=id; workers.execute(()->probeSshWorkspace(machineId,c)); byte[] buffer = new byte[16384]; int n;
          while (!destroyed && connections.get(id) == c && (n = input.read(buffer)) != -1) {
            if (!c.outputSlots.tryAcquire(30, TimeUnit.SECONDS)) throw new IOException("终端渲染超时");
            event(id, "data", Base64.encodeToString(buffer, 0, n, Base64.NO_WRAP));
          }
        } catch (Exception e) { event(id, "error", e.getMessage() == null ? "连接失败" : e.getMessage()); }
        finally { c.close(); final String closedId=id; runOnUiThread(()->browser.disconnected(closedId)); if (!id.isEmpty()) { connections.remove(id, c); event(id, "closed", ""); } }
      });
    }
    @JavascriptInterface public void fileRequest(String json) {
      if (destroyed || json.length()>12000) return;
      try {
        JSONObject request=new JSONObject(json);UUID.fromString(request.getString("request"));
        String id=request.getString("session"), path=request.getString("path"), operation=request.getString("operation");
        if(id.equals("local")){if(pendingTransfer!=null)throw new IOException("请先完成当前文件选择");localFiles.request(request);return;}
        UUID.fromString(id);
        if(path.isEmpty() || path.length()>4096 || path.indexOf(0)>=0 || path.indexOf(10)>=0 || path.indexOf(13)>=0)throw new IOException("路径无效");
        Connection c=connections.get(id);if(c==null || (c.agent==null && (c.session==null || !c.session.isConnected())))throw new IOException("连接已断开");
        if(operation.equals("upload")||operation.equals("download")) runOnUiThread(()->pickTransfer(request));
        else if(operation.equals("list")||operation.equals("preview")) c.files.execute(()->fileOperation(request,null));
        else throw new IOException("不支持的文件操作");
      }catch(Exception e){try{JSONObject r=new JSONObject(json);fileResult(r,new JSONObject().put("error",e.getMessage()));}catch(Exception ignored){}}
    }
    @JavascriptInterface public void input(String id, String text) {
      if (text.length() > 65536 || destroyed) return;
      Connection c = connections.get(id); if (c == null) return;
      if (c.agent != null) { c.agent.input(text); return; }
      try { c.writer.execute(() -> { synchronized(c) { try { if (c.output != null) { c.output.write(text.getBytes(StandardCharsets.UTF_8)); c.output.flush(); } } catch (IOException e) { event(id, "error", "输入失败"); } } }); } catch (RejectedExecutionException ignored) {}
    }
    @JavascriptInterface public void acknowledge(String id) { Connection c = connections.get(id); if (c != null && c.agent != null) { c.agent.acknowledge(); return; } if (c != null && c.outputSlots.availablePermits() < 8) c.outputSlots.release(); }
    @JavascriptInterface public void resize(String id, int cols, int rows) {
      Connection c = connections.get(id); if (c != null && c.agent != null) { c.agent.resize(cols, rows); return; } if (c != null && c.shell != null && cols >= 2 && cols <= 1000 && rows >= 1 && rows <= 500) c.shell.setPtySize(cols, rows, 0, 0);
    }
    @JavascriptInterface public void resetAgentTrust(String host, int port) {
      if (destroyed || !host.matches("[a-zA-Z0-9.:-]{1,253}") || port < 1024 || port > 65535) return;
      final String endpoint="agent:"+host.toLowerCase(Locale.ROOT)+":"+port;
      runOnUiThread(() -> {
        if(destroyed)return;
        new AlertDialog.Builder(MainActivity.this).setTitle("重新核对设备身份？")
          .setMessage(host+":"+port+"\n此地址的 Agent 会话将断开，并清除本机记住的指纹。下次连接必须重新核对身份。不会删除连接配置或改变远端权限。")
          .setNegativeButton("取消",null).setPositiveButton("清除指纹",(dialog,which)->{
            synchronized(trustLock) {
            for(Map.Entry<String,Connection> entry:connections.entrySet()) if(endpoint.equals(entry.getValue().agentEndpoint)) {
              Connection c=entry.getValue();if(connections.remove(entry.getKey(),c)) workers.execute(c::close);
            }
            if(!getSharedPreferences("hosts",MODE_PRIVATE).edit().remove(endpoint).commit()) {
              android.widget.Toast.makeText(MainActivity.this,"清除指纹失败，请重试",android.widget.Toast.LENGTH_LONG).show();return;
            }
            }
            if(!destroyed)web.evaluateJavascript("window.agentTrustReset("+JSONObject.quote(host)+","+port+")",null);
          }).show();
      });
    }
    @JavascriptInterface public void openAgent(String id, int index) {
      Connection c = connections.get(id); if (destroyed || c == null || c.agent == null) return;
      workers.execute(() -> { try { c.agent.open(index); } catch(Exception e) { event(id,"error",e.getMessage()); c.close(); } });
    }
    @JavascriptInterface public void desktopOpen(String id, String options) {
      Connection c=connections.get(id);if(destroyed||c==null||c.agent==null)return;
      final AgentConnection[] holder=new AgentConnection[1];
      synchronized(c){if(c.desktop!=null)return;holder[0]=new AgentConnection((type,value)->{if(c.desktop!=holder[0])return;if(type.startsWith("desktop-")&&!type.equals("desktop-status"))event(id,type,value);if(type.equals("error"))event(id,"desktop-error",value);});c.desktop=holder[0];}
      AgentConnection d=c.desktop;
      workers.execute(()->{try{JSONObject p=new JSONObject(options);connectAgentTransport(d,c,"",()->!destroyed&&connections.get(id)==c&&c.desktop==d);if(c.desktop!=d){d.close();return;}d.desktop(p.getJSONObject("quality"),p.optBoolean("control"));}catch(Exception e){event(id,"desktop-error",e.getMessage());d.close();synchronized(c){if(c.desktop==d)c.desktop=null;}}});
    }
    @JavascriptInterface public void desktopCommand(String id,String command) {
      Connection c=connections.get(id);if(c==null||c.desktop==null)return;
      AgentConnection d=c.desktop;
      // Reuse the bounded native protocol writer; never block WebView callbacks on a socket.
      d.queueDesktopCommand(command);
    }
    @JavascriptInterface public void desktopClose(String id) {Connection c=connections.get(id);if(c==null)return;synchronized(c){AgentConnection d=c.desktop;c.desktop=null;if(d!=null)d.close();}}
    @JavascriptInterface public void disconnect(String id) { runOnUiThread(()->browser.disconnected(id)); Connection c = connections.remove(id); if (c != null) workers.execute(c::close); }
  }
  private void probeSshWorkspace(String id,Connection c) {
    SshAgentBridge bridge=null;
    try {
      bridge=new SshAgentBridge(c.session);
      synchronized(c){if(destroyed||connections.get(id)!=c||!c.session.isConnected()){bridge.close();return;}c.bridge=bridge;}
      event(id,"ssh-workspace","ready");
      JSONObject apps=new JSONObject().put("browser",true);
      if(connections.get(id)==c)event(id,"machine-apps",apps.toString());
      try{JSONObject ide=(JSONObject)bridge.manage("ide.status",new JSONObject());apps.put("ide",ide.optBoolean("supported")&&ide.optBoolean("ready"));if(ide.optBoolean("supported"))apps.put("market",true);}catch(Exception ignored){}
      try{JSONObject coding=(JSONObject)bridge.manage("coding.status",new JSONObject());if(coding.optBoolean("supported"))apps.put("market",true);JSONArray engines=coding.optJSONArray("engines");if(engines!=null)for(int i=0;i<engines.length();i++){JSONObject e=engines.getJSONObject(i);apps.put(e.getString("engine"),e.optBoolean("ready"));}}catch(Exception ignored){}
      if(connections.get(id)==c)event(id,"machine-apps",apps.toString());
    }catch(Exception e){if(bridge!=null)bridge.close();if(connections.get(id)==c)event(id,"ssh-workspace","unavailable");}
  }
  private void connectAgentTransport(AgentConnection connection,Connection saved,String password,java.util.function.BooleanSupplier alive)throws Exception{
    JSONObject device=saved.cloudAgentId==null||saved.cloudAgentId.isEmpty()?null:cloud.cloudAgent(saved.cloudAgentId);
    if(device==null){connection.connect(saved.agentHost,saved.agentPort,password,certificate->trust(saved.agentEndpoint,certificate,alive));return;}
    byte[] expected=java.security.cert.CertificateFactory.getInstance("X.509").generateCertificate(new java.io.ByteArrayInputStream(device.getString("certificate").getBytes(java.nio.charset.StandardCharsets.UTF_8))).getEncoded();
    connection.connect(saved.agentHost,saved.agentPort,device.getString("accountPassword"),certificate->alive.getAsBoolean()&&java.security.MessageDigest.isEqual(expected,certificate),device.getJSONObject("relay"));
  }
  private void connectAgent(String json) {
    workers.execute(() -> {
      String id = ""; Connection c = new Connection();
      try {
        JSONObject p = new JSONObject(json); id = p.getString("id"); UUID.fromString(id);
        String host = p.getString("host").trim(); int port = p.getInt("port");
        if (!host.matches("[a-zA-Z0-9.:-]{1,253}") || port < 1024 || port > 65535 || connections.size() >= 12) throw new IOException("Agent 地址、端口无效或连接数已满");
        String password=p.optString("password");if(password.length()>128)throw new IOException("凭证过长");
        final String sessionId=id, endpoint="agent:"+host.toLowerCase(Locale.ROOT)+":"+port;
        c.agentEndpoint=endpoint;
        c.agentHost=host;c.agentPort=port;
        c.agent = new AgentConnection((type,value)->{
          if(type.equals("closed")) { runOnUiThread(()->browser.disconnected(sessionId)); connections.remove(sessionId,c); if(c.desktop!=null)c.desktop.close(); c.files.shutdownNow(); c.writer.shutdownNow(); }
          event(sessionId,type,value);
        });
        if(connections.putIfAbsent(id,c)!=null)throw new IOException("连接已存在");
        c.cloudAgentId=p.optString("cloudProfileId");
        connectAgentTransport(c.agent,c,password,()->!destroyed&&connections.get(sessionId)==c);
        if(destroyed || connections.get(id)!=c)c.close();
      } catch(Exception e) { event(id,"error",e.getMessage()==null?"Agent 连接失败":e.getMessage()); c.close(); if(!id.isEmpty())connections.remove(id,c); }
    });
  }
  private JSONObject pendingTransfer;
  private void fileResult(JSONObject request,JSONObject value) {
    try{value.put("request",request.getString("request"));String json=value.toString();runOnUiThread(()->{if(!destroyed)web.evaluateJavascript("window.fileEvent("+JSONObject.quote(json)+")",null);});}catch(Exception ignored){}
  }
  private void pickTransfer(JSONObject request) {
    if(localFiles.hasPendingPicker()){try{fileResult(request,new JSONObject().put("error","请先完成当前文件选择"));}catch(Exception ignored){}return;}
    try {
      if(pendingTransfer!=null)throw new IOException("请先完成当前文件选择");
      pendingTransfer=request;
      boolean upload=request.getString("operation").equals("upload");
      Intent intent=new Intent(upload?Intent.ACTION_OPEN_DOCUMENT:Intent.ACTION_CREATE_DOCUMENT);
      intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("application/octet-stream");
      if(upload)intent.setType("*/*");
      else {String path=request.getString("path");intent.putExtra(Intent.EXTRA_TITLE,path.substring(path.lastIndexOf('/')+1));}
      startActivityForResult(intent,4401);
    }catch(Exception e){if(pendingTransfer==request)pendingTransfer=null;try{fileResult(request,new JSONObject().put("error",e.getMessage()));}catch(Exception ignored){}}
  }
  @Override protected void onActivityResult(int code,int result,Intent data) {
    super.onActivityResult(code,result,data);
    if(code==7140){browser.fileResult(result,data);return;}
    if(localFiles.onActivityResult(code,result,data))return;
    if(code==7107){
      if(result!=RESULT_OK||data==null){AndroidAgentService.starting(this,false,"未开始共享：屏幕录制未获授权");return;}
      try{
        if(!AndroidAgentSettings.read(this).getBoolean("enabled")){AndroidAgentService.starting(this,false,"");return;}
        androidx.core.content.ContextCompat.startForegroundService(this,new Intent(this,AndroidAgentService.class).putExtra("result",result).putExtra("consent",data));
      }catch(Exception e){AndroidAgentService.starting(this,false,e.getMessage());}
      return;
    }
    if(code!=4401 || pendingTransfer==null)return;
    JSONObject request=pendingTransfer;pendingTransfer=null;
    try {
      if(result!=RESULT_OK||data==null||data.getData()==null){fileResult(request,new JSONObject().put("cancelled",true));return;}
      Connection c=connections.get(request.getString("session"));if(c==null)throw new IOException("连接已断开");
      Uri uri=data.getData();
      c.files.execute(()->fileOperation(request,uri));
    }catch(Exception e){try{fileResult(request,new JSONObject().put("error",e.getMessage()));}catch(Exception ignored){}}
  }
  private void fileOperation(JSONObject request,Uri uri) {
    ChannelSftp channel=null;
    try {
      Connection c=connections.get(request.getString("session"));if(c==null)throw new IOException("连接已断开");
      if(c.agent!=null){fileResult(request,AgentFiles.operation(getContentResolver(),c.agent,request,uri,()->destroyed||Thread.currentThread().isInterrupted()));return;}
      if(c.session==null || !c.session.isConnected())throw new IOException("连接已断开");
      channel=(ChannelSftp)c.session.openChannel("sftp");channel.connect(15000);
      String path=request.getString("path"),op=request.getString("operation");JSONObject result=new JSONObject();
      if(op.equals("list")){
        String canonical=channel.realpath(path);JSONArray entries=new JSONArray();
        Vector<ChannelSftp.LsEntry> values=channel.ls(canonical);
        if(values.size()>10000)throw new IOException("目录超过 10000 项，请打开更小的目录");
        values.sort((a,b)->{int d=Boolean.compare(b.getAttrs().isDir(),a.getAttrs().isDir());return d!=0?d:a.getFilename().compareToIgnoreCase(b.getFilename());});
        for(ChannelSftp.LsEntry item:values){String name=item.getFilename();if(name.equals(".")||name.equals(".."))continue;
          entries.put(new JSONObject().put("name",name).put("path",canonical+(canonical.endsWith("/")?"":"/")+name).put("directory",item.getAttrs().isDir()).put("size",item.getAttrs().getSize()));}
        result.put("path",canonical).put("entries",entries);
      }else if(op.equals("preview")){
        if(channel.stat(path).getSize()>65536)throw new IOException("文件超过 64 KiB，请下载后查看");
        try(InputStream in=channel.get(path);ByteArrayOutputStream out=new ByteArrayOutputStream()){
          byte[] bytes=new byte[4096];int n;while((n=in.read(bytes))!=-1){if(out.size()+n>65536)throw new IOException("文件超过预览限制");out.write(bytes,0,n);}
          byte[] bytesAll=out.toByteArray();for(byte b:bytesAll)if(b==0)throw new IOException("二进制文件，请下载后查看");
          String text=StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytesAll)).toString();
          result.put("name",path.substring(path.lastIndexOf('/')+1)).put("text",text);
        }
      }else if(op.equals("download")){
        try(InputStream in=channel.get(path);OutputStream out=getContentResolver().openOutputStream(uri,"w")){if(out==null)throw new IOException("无法写入文件");copyFile(in,out);}
      }else if(op.equals("upload")){
        String name=null;try(android.database.Cursor cursor=getContentResolver().query(uri,new String[]{android.provider.OpenableColumns.DISPLAY_NAME},null,null,null)){if(cursor!=null&&cursor.moveToFirst())name=cursor.getString(0);}
        if(name==null||name.isEmpty()||name.equals(".")||name.equals("..")||name.contains("/")||name.contains("\\")||name.indexOf(0)>=0)throw new IOException("文件名无效");
        String directory=channel.realpath(path),destination=directory+(directory.endsWith("/")?"":"/")+name;
        boolean exists=true;try{channel.lstat(destination);}catch(SftpException e){if(e.id==ChannelSftp.SSH_FX_NO_SUCH_FILE)exists=false;else throw e;}
        if(exists)throw new IOException("目标存在同名文件，请先重命名后上传");
        // Upload to a unique temporary path; publish only after the stream completes.
        String temporary=directory+(directory.endsWith("/")?"":"/")+".cshell-upload-"+UUID.randomUUID();
        try {
          try(InputStream in=getContentResolver().openInputStream(uri);OutputStream out=channel.put(temporary)){if(in==null)throw new IOException("无法读取文件");copyFile(in,out);}
          try{channel.lstat(destination);throw new IOException("目标已存在，未覆盖");}catch(SftpException e){if(e.id!=ChannelSftp.SSH_FX_NO_SUCH_FILE)throw e;}
          channel.rename(temporary,destination);
        }finally{try{channel.rm(temporary);}catch(Exception ignored){}}
      }
      fileResult(request,result);
    }catch(Exception e){try{fileResult(request,new JSONObject().put("error",e.getMessage()==null?"文件操作失败":e.getMessage()));}catch(Exception ignored){} }
    finally{if(channel!=null)channel.disconnect();}
  }
  private void copyFile(InputStream in,OutputStream out)throws IOException {
    byte[] bytes=new byte[65536];int n;while((n=in.read(bytes))!=-1){if(destroyed||Thread.currentThread().isInterrupted())throw new IOException("传输已停止");out.write(bytes,0,n);}
  }
  @Override public void onDestroy() {
    localFiles.close();
    browser.close();
    destroyed = true; for (Connection c : connections.values()) c.close(); connections.clear(); workers.shutdownNow();
    unregisterReceiver(cagentEvents);
    web.removeJavascriptInterface("CShellNative"); web.destroy(); super.onDestroy();
  }
  @Override protected void onResume(){super.onResume();if(web!=null)event("","cagent-status",AndroidAgentService.status(this).toString());}
  @Override protected void onPause(){super.onPause();for(Connection c:connections.values()){synchronized(c){if(c.desktop!=null)c.desktop.close();c.desktop=null;}}}
  private void navigateBack() {
    if(browser!=null&&browser.back())return;
    web.evaluateJavascript("window.mobileBack()", result -> {
      if (!"true".equals(result)) moveTaskToBack(true);
    });
  }
  @Override public boolean onKeyUp(int keyCode, android.view.KeyEvent event) {
    if (android.os.Build.VERSION.SDK_INT < 33 && keyCode == android.view.KeyEvent.KEYCODE_BACK) {
      navigateBack(); return true;
    }
    return super.onKeyUp(keyCode, event);
  }
}
