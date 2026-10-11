package org.canpshell.mobile;

import android.app.Activity;
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
    final ExecutorService writer = Executors.newSingleThreadExecutor();
    final Semaphore outputSlots = new Semaphore(8);
    synchronized void close() { writer.shutdownNow(); outputSlots.release(8); if (shell != null) shell.disconnect(); if (session != null) session.disconnect(); }
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
