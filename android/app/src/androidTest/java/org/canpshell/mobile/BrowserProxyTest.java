package org.canpshell.mobile;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.json.*;
import android.util.Base64;
final class BrowserProxyTest {
  static String ui(android.app.Instrumentation instrumentation)throws Exception{
    AtomicBoolean supported=new AtomicBoolean();instrumentation.runOnMainSync(()->supported.set(MachineBrowser.supported()));
    if(!supported.get())return "\nBrowser UI: required WebView features unavailable; entry must remain hidden";
    android.content.Intent intent=new android.content.Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
    android.app.Activity activity=instrumentation.startActivitySync(intent);ExecutorService workers=Executors.newCachedThreadPool();
    ConcurrentHashMap<String,BlockingQueue<byte[]>> channels=new ConcurrentHashMap<>();AtomicInteger requests=new AtomicInteger();
    MachineBrowserProxy.Rpc rpc=(method,raw)->{JSONObject p=(JSONObject)raw;switch(method){
      case "browser.status":return new JSONObject();
      case "browser.open":if(!"127.0.0.1".equals(p.getString("host")))throw new Exception("Unexpected external target");String id=java.util.UUID.randomUUID().toString();channels.put(id,new LinkedBlockingQueue<>());requests.incrementAndGet();return new JSONObject().put("id",id);
      case "browser.write":channels.get(p.getString("id")).offer(new byte[]{1});return new JSONObject();
      case "browser.read":BlockingQueue<byte[]> queue=channels.get(p.getString("id"));if(queue==null||queue.poll(5,TimeUnit.SECONDS)==null)throw new Exception("No request");String html="<meta name='viewport' content='width=device-width,initial-scale=1'><title>Browser fixture</title><style>body{font:18px sans-serif;margin:24px}</style><h1>Machine browser</h1><button onclick=\"document.querySelector('h1').textContent='Clicked'\">Click</button>";byte[] body=html.getBytes(StandardCharsets.UTF_8);ByteArrayOutputStream bytes=new ByteArrayOutputStream();bytes.write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: "+body.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));bytes.write(body);return new JSONObject().put("data",Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP)).put("ended",true);
      case "browser.close":channels.remove(p.getString("id"));return new JSONObject();default:throw new Exception("Unexpected RPC");}};
    AtomicReference<MachineBrowser> browser=new AtomicReference<>();AtomicReference<android.widget.FrameLayout> holder=new AtomicReference<>();
    instrumentation.runOnMainSync(()->{android.widget.FrameLayout root=new android.widget.FrameLayout(activity);activity.addContentView(root,new android.view.ViewGroup.LayoutParams(-1,-1));holder.set(root);MachineBrowser b=new MachineBrowser(activity,root,workers);browser.set(b);b.open("fixture-target","Fixture machine","fixture-ui-"+System.currentTimeMillis(),rpc,"http://127.0.0.1:47881/");});
    try{boolean loaded=false;for(int i=0;i<100;i++){AtomicBoolean found=new AtomicBoolean();instrumentation.runOnMainSync(()->found.set(findLoaded(holder.get())));if(found.get()){loaded=true;break;}Thread.sleep(200);}if(!loaded||requests.get()==0)throw new Exception("Browser fixture did not load through target proxy");instrumentation.runOnMainSync(()->browser.get().disconnected("fixture-target"));return "\nBrowser UI: native WebView loaded via target-only proxy and disconnected";}finally{instrumentation.runOnMainSync(()->{browser.get().close();activity.finish();});workers.shutdownNow();}
  }
  private static boolean findLoaded(android.view.View v){if(v instanceof android.webkit.WebView)return "Browser fixture".equals(((android.webkit.WebView)v).getTitle());if(v instanceof android.view.ViewGroup){android.view.ViewGroup g=(android.view.ViewGroup)v;for(int i=0;i<g.getChildCount();i++)if(findLoaded(g.getChildAt(i)))return true;}return false;}
  static String run()throws Exception{
    AtomicReference<String> host=new AtomicReference<>();BlockingQueue<byte[]> written=new LinkedBlockingQueue<>();AtomicInteger closed=new AtomicInteger();
    MachineBrowserProxy proxy=new MachineBrowserProxy((method,raw)->{JSONObject p=(JSONObject)raw;
      switch(method){case "browser.status":return new JSONObject();case "browser.open":host.set(p.getString("host"));return new JSONObject().put("id","test-channel");case "browser.write":if(p.getLong("sequence")!=0)throw new Exception("Wrong write order");written.add(Base64.decode(p.getString("data"),Base64.DEFAULT));return new JSONObject();case "browser.read":byte[] b=written.poll(5,TimeUnit.SECONDS);if(b==null)throw new Exception("No tunnel bytes");return new JSONObject().put("data",Base64.encodeToString(b,Base64.NO_WRAP)).put("ended",true);case "browser.close":closed.incrementAndGet();return new JSONObject();default:throw new Exception("Unexpected method");}
    });
    try(Socket socket=new Socket("127.0.0.1",proxy.port())){socket.setSoTimeout(7000);OutputStream out=socket.getOutputStream();DataInputStream in=new DataInputStream(socket.getInputStream());out.write(new byte[]{5,1,0});if(in.readUnsignedByte()!=5||in.readUnsignedByte()!=0)throw new Exception("SOCKS handshake failed");byte[] domain="route-fixture.invalid".getBytes(StandardCharsets.US_ASCII);out.write(new byte[]{5,1,0,3,(byte)domain.length});out.write(domain);out.write(new byte[]{1,(byte)187});byte[] response=new byte[10];in.readFully(response);if(response[1]!=0||!"route-fixture.invalid".equals(host.get()))throw new Exception("DNS did not remain on target");out.write("fixture".getBytes(StandardCharsets.US_ASCII));out.flush();byte[] echo=new byte[7];in.readFully(echo);if(!"fixture".equals(new String(echo,StandardCharsets.US_ASCII)))throw new Exception("Tunnel bytes changed");}finally{proxy.close();}
    return "OK (browser SOCKS target DNS, ordered bytes, bounded cleanup)";
  }
}
