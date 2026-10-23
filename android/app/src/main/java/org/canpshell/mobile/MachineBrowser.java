package org.canpshell.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.*;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.view.*;
import android.view.inputmethod.InputMethodManager;
import android.webkit.*;
import android.widget.*;
import androidx.webkit.*;
import org.json.*;
import java.io.ByteArrayInputStream;
import java.util.*;
import java.util.concurrent.ExecutorService;

/** Native mobile browser chrome. Untrusted pages never receive a JavaScript bridge. */
final class MachineBrowser implements AutoCloseable {
  private final Activity activity; private final FrameLayout parent; private final ExecutorService workers;
  private final LinearLayout layout,toolbar,ideKeys; private final FrameLayout viewport; private final TextView status;
  private final AutoCompleteTextView address; private final ProgressBar progress;
  private final ArrayList<WebView> tabs=new ArrayList<>();
  private WebView current; private View custom; private WebChromeClient.CustomViewCallback customCallback;
  private LinearLayout panel; private MachineBrowserProxy proxy; private String target="",profile="",label="";
  private boolean ready,closed,desktop,editor; private JSONArray history=new JSONArray(),bookmarks=new JSONArray();
  private int selected;
  private long generation;
  private ValueCallback<Uri[]> files;
  static boolean supported(){return WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)&&WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)&&WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);}
  MachineBrowser(Activity activity,FrameLayout parent,ExecutorService workers){
    this.activity=activity;this.parent=parent;this.workers=workers;
    layout=new LinearLayout(activity);layout.setOrientation(LinearLayout.VERTICAL);layout.setBackgroundColor(Color.rgb(247,249,253));layout.setVisibility(View.GONE);
    status=new TextView(activity);status.setTextSize(12);status.setTextColor(Color.rgb(89,108,133));status.setPadding(dp(16),dp(8),dp(16),dp(8));layout.addView(status);
    progress=new ProgressBar(activity,null,android.R.attr.progressBarStyleHorizontal);layout.addView(progress,new LinearLayout.LayoutParams(-1,dp(2)));
    viewport=new FrameLayout(activity);layout.addView(viewport,new LinearLayout.LayoutParams(-1,0,1));
    LinearLayout addressRow=new LinearLayout(activity);addressRow.setGravity(Gravity.CENTER_VERTICAL);addressRow.setPadding(dp(8),dp(6),dp(8),dp(6));
    address=new AutoCompleteTextView(activity);address.setSingleLine(true);address.setTextSize(15);address.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI);address.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_GO);address.setHint("搜索网址或历史记录");address.setPadding(dp(14),0,dp(14),0);address.setBackground(background(Color.rgb(233,239,247),14));
    addressRow.addView(address,new LinearLayout.LayoutParams(0,dp(46),1));addressRow.addView(button("↻","刷新网页",()->{if(ready&&current!=null)current.reload();}));layout.addView(addressRow);
    address.setOnEditorActionListener((v,action,event)->{navigate(address.getText().toString());return true;});address.setOnItemClickListener((p,v,pos,id)->navigate(String.valueOf(p.getItemAtPosition(pos))));
    toolbar=new LinearLayout(activity);toolbar.setGravity(Gravity.CENTER);toolbar.setPadding(dp(4),0,dp(4),dp(4));
    addTool("‹","后退",()->{if(current!=null&&current.canGoBack())current.goBack();});addTool("›","前进",()->{if(current!=null&&current.canGoForward())current.goForward();});addTool("▣","标签页",this::showTabs);addTool("☆","收藏网页",this::bookmark);addTool("···","浏览器菜单",this::menu);addTool("⌂","返回机器",this::hide);
    ideKeys=new LinearLayout(activity);ideKeys.setGravity(Gravity.CENTER);ideKeys.setVisibility(View.GONE);
    String[] labels={"文件","搜索文件","命令","保存"};int[] keys={KeyEvent.KEYCODE_B,KeyEvent.KEYCODE_P,KeyEvent.KEYCODE_P,KeyEvent.KEYCODE_S};
    for(int i=0;i<labels.length;i++){final int key=keys[i],meta=KeyEvent.META_CTRL_ON|(i==2?KeyEvent.META_SHIFT_ON:0);ideKeys.addView(button(labels[i],labels[i],()->{if(current!=null){current.requestFocus();long now=android.os.SystemClock.uptimeMillis();current.dispatchKeyEvent(new KeyEvent(now,now,KeyEvent.ACTION_DOWN,key,0,meta));current.dispatchKeyEvent(new KeyEvent(now,now,KeyEvent.ACTION_UP,key,0,meta));}}),new LinearLayout.LayoutParams(0,dp(42),1));}
    layout.addView(ideKeys);layout.addView(toolbar);parent.addView(layout,new FrameLayout.LayoutParams(-1,-1));
  }
  private int dp(int v){return Math.round(v*activity.getResources().getDisplayMetrics().density);}
  private GradientDrawable background(int color,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));return d;}
  private Button button(String text,String label,Runnable run){Button b=new Button(activity);b.setText(text);b.setTextSize(17);b.setTextColor(Color.rgb(35,54,78));b.setContentDescription(label);b.setAllCaps(false);b.setMinWidth(0);b.setMinimumWidth(0);b.setPadding(dp(9),0,dp(9),0);b.setBackground(background(Color.TRANSPARENT,10));b.setOnClickListener(v->run.run());return b;}
  private void addTool(String text,String label,Runnable run){toolbar.addView(button(text,label,run),new LinearLayout.LayoutParams(0,dp(48),1));}
  void editor(boolean value){editor=value;addressRowVisibility(!value);status.setVisibility(View.VISIBLE);for(int i=0;i<toolbar.getChildCount()-1;i++)toolbar.getChildAt(i).setVisibility(value?View.GONE:View.VISIBLE);ideKeys.setVisibility(value?View.VISIBLE:View.GONE);}
  private String owner="guest";
  void account(String next){if(!next.equals(owner)){close();owner=next;}}
  void open(String id,String name,AgentConnection agent,String url){open(id,name,agent.browserIdentity(),agent::manage,url);}
  void open(String id,String name,String identity,MachineBrowserProxy.Rpc agent,String url){open(id,name,identity,agent,null,url);}
  void openSsh(String id,String name,String identity,com.jcraft.jsch.Session ssh,String url){open(id,name,identity,null,ssh,url);}
  private void open(String id,String name,String identity,MachineBrowserProxy.Rpc agent,com.jcraft.jsch.Session ssh,String url){
    if(!supported()){Toast.makeText(activity,"请更新 Android System WebView 以使用独立机器浏览器",Toast.LENGTH_LONG).show();return;}
    if(target.equals(id)&&profile.equals("machine-"+owner+"-"+identity+(editor?"-ide":""))&&ready){layout.setVisibility(View.VISIBLE);layout.bringToFront();if(current!=null)current.onResume();if(url!=null&&!url.isEmpty())navigate(url);return;}
    closeSession();closed=false;target=id;label=name;profile="machine-"+owner+"-"+identity+(editor?"-ide":"");
    layout.setVisibility(View.VISIBLE);layout.bringToFront();status.setText("正在连接 · "+name);progress.setVisibility(View.VISIBLE);progress.setIndeterminate(true);
    final String requested=id; final long opening=generation;
    workers.execute(()->{try{MachineBrowserProxy next=ssh!=null?new MachineBrowserProxy(ssh):new MachineBrowserProxy(agent);activity.runOnUiThread(()->{
      if(closed||generation!=opening||!target.equals(requested)){next.close();return;}proxy=next;
      ProxyController.getInstance().setProxyOverride(new ProxyConfig.Builder().addProxyRule("socks://127.0.0.1:"+next.port()).removeImplicitRules().build(),activity::runOnUiThread,()->{
        if(closed||generation!=opening||proxy!=next)return;ready=true;progress.setIndeterminate(false);status.setText(editor?"代码编辑器 · "+name:name+" · 机器网络");restore();if(tabs.isEmpty())newTab("about:blank");if(url!=null&&!url.isEmpty())navigate(url);
      });
    });}catch(Exception e){activity.runOnUiThread(()->{if(generation==opening&&target.equals(requested)){status.setText("连接失败 · "+e.getMessage());progress.setVisibility(View.GONE);}});}});
  }
  private boolean allowed(String url){try{Uri u=Uri.parse(url);return ("https".equals(u.getScheme())||"http".equals(u.getScheme()))&&u.getHost()!=null&&u.getUserInfo()==null;}catch(Exception e){return false;}}
  private WebView newTab(String url){
    if(!ready||tabs.size()>=12){Toast.makeText(activity,"最多打开 12 个标签页",Toast.LENGTH_SHORT).show();return null;}
    final long pageGeneration=generation;
    WebView w=new WebView(activity);WebViewCompat.setProfile(w,profile);
    WebSettings s=w.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setSupportMultipleWindows(true);s.setJavaScriptCanOpenWindowsAutomatically(false);s.setUseWideViewPort(true);s.setLoadWithOverviewMode(true);s.setBuiltInZoomControls(true);s.setDisplayZoomControls(false);s.setMediaPlaybackRequiresUserGesture(true);s.setGeolocationEnabled(false);
    // WebRTC UDP does not use Chromium's URL proxy. Remove this unsupported API before page scripts.
    WebViewCompat.addDocumentStartJavaScript(w,"for(const k of ['RTCPeerConnection','webkitRTCPeerConnection']){try{Object.defineProperty(globalThis,k,{value:undefined,writable:false,configurable:false})}catch{}}",Collections.singleton("*"));
    WebViewCompat.getProfile(w).getServiceWorkerController().getServiceWorkerWebSettings().setBlockNetworkLoads(true);
    w.setWebViewClient(new WebViewClient(){
      @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest r){return pageGeneration!=generation||!ready||!allowed(r.getUrl().toString());}
      @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest r){String u=r.getUrl().toString();if(pageGeneration!=generation||!ready||(!allowed(u)&&!u.startsWith("data:")&&!u.startsWith("blob:")&&!u.equals("about:blank")))return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));return null;}
      @Override public void onPageFinished(WebView view,String url){if(!tabs.contains(view))return;if(view==current){address.setText(url.equals("about:blank")?"":url);status.setText(editor?"代码编辑器 · "+label:label+" · 机器网络");}if(allowed(url)){visit(url,view.getTitle());save();}}
      @Override public void onReceivedError(WebView view,WebResourceRequest r,WebResourceError e){if(r.isForMainFrame()&&view==current)status.setText("网页未加载 · "+e.getDescription());}
      @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,android.net.http.SslError error){handler.cancel();status.setText("证书验证失败，已停止访问");}
    });
    w.setDownloadListener((downloadUrl,agent,disposition,mime,size)->Toast.makeText(activity,"网页下载尚未接入，请从机器的文件应用传输",Toast.LENGTH_LONG).show());
    w.setWebChromeClient(new WebChromeClient(){
      @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){if(files!=null)files.onReceiveValue(null);files=callback;try{Intent intent=params.createIntent();intent.addCategory(Intent.CATEGORY_OPENABLE);activity.startActivityForResult(intent,7140);return true;}catch(Exception e){files=null;return false;}}
      @Override public void onProgressChanged(WebView view,int value){if(view==current){progress.setProgress(value);progress.setVisibility(value<100?View.VISIBLE:View.GONE);}}
      @Override public void onPermissionRequest(PermissionRequest request){request.deny();}
      @Override public void onReceivedTitle(WebView view,String title){if(!tabs.contains(view))return;if(allowed(view.getUrl())){visit(view.getUrl(),title);save();}}
      @Override public boolean onCreateWindow(WebView view,boolean dialog,boolean gesture,android.os.Message message){if(!gesture||!ready||tabs.size()>=12)return false;WebView child=newTab("about:blank");if(child==null)return false;((WebView.WebViewTransport)message.obj).setWebView(child);message.sendToTarget();return true;}
      @Override public void onCloseWindow(WebView view){closeTab(view);}
      @Override public void onShowCustomView(View view,CustomViewCallback callback){if(custom!=null){callback.onCustomViewHidden();return;}custom=view;customCallback=callback;viewport.addView(view,new FrameLayout.LayoutParams(-1,-1));toolbar.setVisibility(View.GONE);addressRowVisibility(false);}
      @Override public void onHideCustomView(){exitFullscreen();}
    });
    tabs.add(w);select(w);if(allowed(url))w.loadUrl(url);return w;
  }
  private void addressRowVisibility(boolean visible){((View)address.getParent()).setVisibility(visible?View.VISIBLE:View.GONE);status.setVisibility(visible?View.VISIBLE:View.GONE);}
  private void exitFullscreen(){if(custom!=null){viewport.removeView(custom);custom=null;WebChromeClient.CustomViewCallback c=customCallback;customCallback=null;if(c!=null)c.onCustomViewHidden();}toolbar.setVisibility(View.VISIBLE);addressRowVisibility(!editor);}
  private void select(WebView w){dismissPanel();if(current!=null){viewport.removeView(current);current.onPause();}current=w;selected=tabs.indexOf(w);viewport.addView(w,new FrameLayout.LayoutParams(-1,-1));w.onResume();address.setText(allowed(w.getUrl())?w.getUrl():"");updateIdeKeys(w.getUrl());save();}
  private void closeTab(WebView w){boolean active=w==current;if(active){viewport.removeView(w);current=null;}tabs.remove(w);w.stopLoading();w.destroy();if(active&&!tabs.isEmpty())select(tabs.get(Math.max(0,Math.min(selected,tabs.size()-1))));if(tabs.isEmpty())newTab("about:blank");save();}
  private void updateIdeKeys(String url){Uri u=Uri.parse(url==null?"":url);ideKeys.setVisibility(editor||"127.0.0.1".equals(u.getHost())&&u.getQueryParameter("folder")!=null?View.VISIBLE:View.GONE);}
  private void navigate(String value){if(!ready||current==null)return;String url=value.trim();if(!url.contains("://"))url="https://"+url;if(!allowed(url)){status.setText("请输入有效的 http 或 https 网址");return;}dismissPanel();address.clearFocus();((InputMethodManager)activity.getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(address.getWindowToken(),0);updateIdeKeys(url);current.loadUrl(url);}
  private void showPanel(String title){dismissPanel();panel=new LinearLayout(activity);panel.setOrientation(LinearLayout.VERTICAL);panel.setPadding(dp(16),dp(16),dp(16),dp(16));panel.setBackground(background(Color.rgb(247,249,253),18));TextView h=new TextView(activity);h.setText(title);h.setTextSize(22);h.setPadding(0,0,0,dp(14));panel.addView(h);ScrollView scroll=new ScrollView(activity);scroll.addView(panel);scroll.setTag("browser-panel");viewport.addView(scroll,new FrameLayout.LayoutParams(-1,-1));}
  private void dismissPanel(){View p=viewport.findViewWithTag("browser-panel");if(p!=null)viewport.removeView(p);panel=null;}
  private void option(String text,Runnable run){Button b=button(text,text,run);b.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);b.setTextSize(15);panel.addView(b,new LinearLayout.LayoutParams(-1,dp(52)));}
  private void showTabs(){showPanel("标签页 · "+tabs.size());option("＋ 新标签页",()->newTab("about:blank"));for(WebView w:new ArrayList<>(tabs)){LinearLayout row=new LinearLayout(activity);Button b=button((w==current?"● ":"")+(w.getTitle()==null?"新标签页":w.getTitle()),"切换标签页",()->select(w));b.setTextSize(14);b.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);row.addView(b,new LinearLayout.LayoutParams(0,dp(58),1));row.addView(button("×","关闭标签页",()->{closeTab(w);showTabs();}));panel.addView(row);}}
  private void menu(){showPanel("浏览器");option("历史记录",()->library(false));option("收藏夹",()->library(true));option(desktop?"切换为手机版网站":"请求桌面版网站",()->{desktop=!desktop;String ua=WebSettings.getDefaultUserAgent(activity);current.getSettings().setUserAgentString(desktop?ua.replace("; wv","").replace("Mobile","").replace("Android","Linux"):ua);dismissPanel();current.reload();});option("清除历史记录",()->{history=new JSONArray();save();dismissPanel();});option("清除当前机器的登录状态",()->new AlertDialog.Builder(activity).setTitle("清除登录状态？").setMessage("关闭这台机器的网页并清除 Cookie 和站点数据。收藏夹保留。").setNegativeButton("取消",null).setPositiveButton("清除",(d,n)->clearLogins()).show());option("返回网页",this::dismissPanel);}
  private void library(boolean favorites){showPanel(favorites?"收藏夹":"历史记录");JSONArray source=favorites?bookmarks:history;for(int i=0;i<source.length();i++){JSONObject e=source.optJSONObject(i);if(e==null)continue;String url=e.optString("url");LinearLayout row=new LinearLayout(activity);Button b=button(e.optString("title",url)+"\n"+url,"打开 "+url,()->navigate(url));b.setTextSize(13);b.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);row.addView(b,new LinearLayout.LayoutParams(0,dp(70),1));row.addView(button("×","删除记录",()->{JSONArray next=without(source,url);if(favorites)bookmarks=next;else history=next;save();library(favorites);}));panel.addView(row);}}
  private JSONArray without(JSONArray source,String url){JSONArray a=new JSONArray();for(int i=0;i<source.length();i++){JSONObject v=source.optJSONObject(i);if(v!=null&&!v.optString("url").equals(url))a.put(v);}return a;}
  private void visit(String url,String title){try{JSONArray a=new JSONArray();a.put(new JSONObject().put("url",url).put("title",title==null?url:title));JSONArray rest=without(history,url);for(int i=0;i<Math.min(199,rest.length());i++)a.put(rest.get(i));history=a;ArrayList<String> suggestions=new ArrayList<>();for(int i=0;i<history.length();i++)suggestions.add(history.getJSONObject(i).getString("url"));address.setAdapter(new ArrayAdapter<>(activity,android.R.layout.simple_dropdown_item_1line,suggestions));}catch(Exception ignored){}}
  private void bookmark(){if(current==null||!allowed(current.getUrl()))return;String url=current.getUrl();JSONArray a=without(bookmarks,url);if(a.length()==bookmarks.length())try{a.put(new JSONObject().put("url",url).put("title",current.getTitle()));}catch(Exception ignored){}bookmarks=a;save();Toast.makeText(activity,"收藏夹已更新",Toast.LENGTH_SHORT).show();}
  private void refreshSuggestions(){ArrayList<String> values=new ArrayList<>();for(int i=0;i<history.length();i++){JSONObject item=history.optJSONObject(i);if(item!=null)values.add(item.optString("url"));}address.setAdapter(new ArrayAdapter<>(activity,android.R.layout.simple_dropdown_item_1line,values));}
  private void save(){if(profile.isEmpty()||!ready)return;refreshSuggestions();try{JSONArray saved=new JSONArray();for(WebView w:tabs)saved.put(allowed(w.getUrl())?w.getUrl():"about:blank");BrowserStore.write(activity,profile,new JSONObject().put("tabs",saved).put("selected",selected).put("history",history).put("bookmarks",bookmarks).toString());if(current!=null)WebViewCompat.getProfile(current).getCookieManager().flush();}catch(Exception e){status.setText("浏览器资料保存失败");}}
  private void restore(){try{JSONObject data=new JSONObject(BrowserStore.read(activity,profile));history=data.optJSONArray("history");if(history==null)history=new JSONArray();bookmarks=data.optJSONArray("bookmarks");if(bookmarks==null)bookmarks=new JSONArray();JSONArray urls=data.optJSONArray("tabs");int index=data.optInt("selected");if(urls!=null)for(int i=0;i<Math.min(12,urls.length());i++)newTab(urls.optString(i));if(!tabs.isEmpty())select(tabs.get(Math.max(0,Math.min(index,tabs.size()-1))));}catch(Exception ignored){history=new JSONArray();bookmarks=new JSONArray();}}
  private void clearLogins(){final long clearing=generation;Profile p=current==null?null:WebViewCompat.getProfile(current);for(WebView w:tabs){w.stopLoading();viewport.removeView(w);w.clearCache(true);w.destroy();}tabs.clear();current=null;if(p!=null){p.getWebStorage().deleteAllData();p.getCookieManager().removeAllCookies(ok->{if(clearing!=generation||!ready||closed)return;newTab("about:blank");save();});}else newTab("about:blank");}
  boolean back(){if(layout.getVisibility()!=View.VISIBLE)return false;if(custom!=null){exitFullscreen();return true;}if(panel!=null){dismissPanel();return true;}if(current!=null&&current.canGoBack()){current.goBack();return true;}hide();return true;}
  private void hide(){save();layout.setVisibility(View.GONE);if(current!=null)current.onPause();}
  void disconnected(String id){if(target.equals(id)){generation++;if(files!=null){files.onReceiveValue(null);files=null;}save();ready=false;if(proxy!=null)proxy.close();for(WebView w:tabs){w.stopLoading();w.getSettings().setBlockNetworkLoads(true);}status.setText(label+" · 已断开，网络访问已停止");}}
  private void closeSession(){generation++;if(files!=null){files.onReceiveValue(null);files=null;}save();ready=false;exitFullscreen();dismissPanel();for(WebView w:tabs){w.stopLoading();viewport.removeView(w);w.destroy();}tabs.clear();current=null;if(proxy!=null)proxy.close();proxy=null;}
  void fileResult(int result,Intent data){ValueCallback<Uri[]> callback=files;files=null;if(callback!=null)callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));}
  public void close(){if(files!=null){files.onReceiveValue(null);files=null;}closeSession();closed=true;target="";layout.setVisibility(View.GONE);}
}
