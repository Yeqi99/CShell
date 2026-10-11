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
  private AppUpdates updates;
  private final ExecutorService workers = Executors.newCachedThreadPool();
  private final Map<String, Connection> connections = new ConcurrentHashMap<>();
  private volatile boolean destroyed;
  private static class Connection {
    Session session; ChannelShell shell; OutputStream output;
    final ExecutorService files = Executors.newSingleThreadExecutor();
    final ExecutorService writer = Executors.newSingleThreadExecutor();
    final Semaphore outputSlots = new Semaphore(8);
    synchronized void close() { files.shutdownNow(); writer.shutdownNow(); outputSlots.release(8); if (shell != null) shell.disconnect(); if (session != null) session.disconnect(); }
  }
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    Security.removeProvider("BC"); Security.addProvider(new BouncyCastleProvider());
    web = new WebView(this);
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
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
      @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        String path = uri.getPath();
        if (!"https".equals(uri.getScheme()) || !"cshell.local".equals(uri.getHost()) || path == null || !Arrays.asList("/index.html", "/app.js", "/app.css").contains(path))
          return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
        try {
          String mime = path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : "text/html";
          return new WebResourceResponse(mime, "UTF-8", getAssets().open(path.substring(1)));
        } catch (IOException e) { return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0])); }
      }
    });
    setContentView(web);
    web.setOnApplyWindowInsetsListener((view, insets) -> {
      view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
      return insets.consumeSystemWindowInsets();
    });
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
  private boolean trust(String endpoint, byte[] key) {
    try {
      String fingerprint = "SHA256:" + Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(key), Base64.NO_WRAP | Base64.NO_PADDING);
      String stored = getSharedPreferences("hosts", MODE_PRIVATE).getString(endpoint, null);
      if (stored != null) return stored.equals(fingerprint);
      CountDownLatch answer = new CountDownLatch(1); boolean[] approved = {false};
      runOnUiThread(() -> {
        if (destroyed) { answer.countDown(); return; }
        new AlertDialog.Builder(this).setTitle("核对服务器指纹").setMessage(endpoint + "\n" + fingerprint)
          .setPositiveButton("信任并连接", (dialog, which) -> { approved[0] = true; answer.countDown(); })
          .setNegativeButton("取消", (dialog, which) -> answer.countDown()).setOnCancelListener(dialog -> answer.countDown()).show();
      });
      if (!answer.await(90, TimeUnit.SECONDS) || !approved[0] || destroyed) return false;
      return getSharedPreferences("hosts", MODE_PRIVATE).edit().putString(endpoint, fingerprint).commit();
    } catch (Exception e) { return false; }
  }
  public class Bridge {
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
    @JavascriptInterface public String version() { return updates.current(); }
    @JavascriptInterface public void checkUpdate() { updates.check(); }
    @JavascriptInterface public void installUpdate() { updates.install(); }
    @JavascriptInterface public void connect(String json) {
      if (destroyed) return;
      workers.execute(() -> {
        String id = ""; Connection c = new Connection();
        try {
          JSONObject p = new JSONObject(json); id = p.getString("id"); UUID.fromString(id);
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
          event(id, "connected", ""); byte[] buffer = new byte[16384]; int n;
          while (!destroyed && connections.get(id) == c && (n = input.read(buffer)) != -1) {
            if (!c.outputSlots.tryAcquire(30, TimeUnit.SECONDS)) throw new IOException("终端渲染超时");
            event(id, "data", Base64.encodeToString(buffer, 0, n, Base64.NO_WRAP));
          }
        } catch (Exception e) { event(id, "error", e.getMessage() == null ? "连接失败" : e.getMessage()); }
        finally { c.close(); if (!id.isEmpty()) { connections.remove(id, c); event(id, "closed", ""); } }
      });
    }
    @JavascriptInterface public void fileRequest(String json) {
      if (destroyed || json.length()>12000) return;
      try {
        JSONObject request=new JSONObject(json);UUID.fromString(request.getString("request"));
        String id=request.getString("session"), path=request.getString("path"), operation=request.getString("operation");
        UUID.fromString(id);
        if(path.isEmpty() || path.length()>4096 || path.indexOf(0)>=0 || path.indexOf(10)>=0 || path.indexOf(13)>=0)throw new IOException("路径无效");
        Connection c=connections.get(id);if(c==null || c.session==null || !c.session.isConnected())throw new IOException("连接已断开");
        if(operation.equals("upload")||operation.equals("download")) runOnUiThread(()->pickTransfer(request));
        else if(operation.equals("list")||operation.equals("preview")) c.files.execute(()->fileOperation(request,null));
        else throw new IOException("不支持的文件操作");
      }catch(Exception e){try{JSONObject r=new JSONObject(json);fileResult(r,new JSONObject().put("error",e.getMessage()));}catch(Exception ignored){}}
    }
    @JavascriptInterface public void input(String id, String text) {
      if (text.length() > 65536 || destroyed) return;
      Connection c = connections.get(id); if (c == null) return;
      try { c.writer.execute(() -> { synchronized(c) { try { if (c.output != null) { c.output.write(text.getBytes(StandardCharsets.UTF_8)); c.output.flush(); } } catch (IOException e) { event(id, "error", "输入失败"); } } }); } catch (RejectedExecutionException ignored) {}
    }
    @JavascriptInterface public void acknowledge(String id) { Connection c = connections.get(id); if (c != null && c.outputSlots.availablePermits() < 8) c.outputSlots.release(); }
    @JavascriptInterface public void resize(String id, int cols, int rows) {
      Connection c = connections.get(id); if (c != null && c.shell != null && cols >= 2 && cols <= 1000 && rows >= 1 && rows <= 500) c.shell.setPtySize(cols, rows, 0, 0);
    }
    @JavascriptInterface public void disconnect(String id) { Connection c = connections.remove(id); if (c != null) workers.execute(c::close); }
  }
  private JSONObject pendingTransfer;
  private void fileResult(JSONObject request,JSONObject value) {
    try{value.put("request",request.getString("request"));String json=value.toString();runOnUiThread(()->{if(!destroyed)web.evaluateJavascript("window.fileEvent("+JSONObject.quote(json)+")",null);});}catch(Exception ignored){}
  }
  private void pickTransfer(JSONObject request) {
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
      Connection c=connections.get(request.getString("session"));if(c==null || c.session==null || !c.session.isConnected())throw new IOException("连接已断开");
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
    destroyed = true; for (Connection c : connections.values()) c.close(); connections.clear(); workers.shutdownNow();
    web.removeJavascriptInterface("CShellNative"); web.destroy(); super.onDestroy();
  }
  private void navigateBack() {
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
