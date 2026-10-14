package org.canpshell.mobile;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import org.json.*;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.function.Consumer;

/** GitHub-only update source; the WebView cannot choose URLs or executable files. */
final class AppUpdates {
  private final Activity activity;
  private final ExecutorService worker;
  private final Consumer<String> emit;
  private volatile boolean busy;
  private String url, sums, name, version, readyHash;
  private long size;
  private File ready;
  AppUpdates(Activity activity, ExecutorService worker, Consumer<String> emit) {
    this.activity=activity; this.worker=worker; this.emit=emit;
  }
  String current() {
    try { return activity.getPackageManager().getPackageInfo(activity.getPackageName(),0).versionName; }
    catch(Exception e) { return "unknown"; }
  }
  private void state(String message, boolean available, int progress) {
    try {
      JSONObject value=new JSONObject().put("message",message).put("busy",busy).put("available",available).put("ready",ready!=null);
      if(progress>=0)value.put("progress",progress);
      emit.accept(value.toString());
    }catch(JSONException ignored){}
  }
  private static int compare(String a,String b) {
    String[] x=a.replaceFirst("^v","").split("\\."),y=b.replaceFirst("^v","").split("\\.");
    for(int i=0;i<3;i++){int diff=Integer.compare(Integer.parseInt(x[i]),Integer.parseInt(y[i]));if(diff!=0)return diff;}
    return 0;
  }
  private HttpURLConnection request(String address) throws Exception {
    for(int i=0;i<6;i++){
      URL u=new URL(address);
      if(!"https".equals(u.getProtocol())||!Arrays.asList("api.github.com","github.com","release-assets.githubusercontent.com","objects.githubusercontent.com").contains(u.getHost()))throw new IOException("更新下载地址无效");
      HttpURLConnection c=(HttpURLConnection)u.openConnection();c.setConnectTimeout(20000);c.setReadTimeout(30000);c.setInstanceFollowRedirects(false);c.setRequestProperty("User-Agent","CShell/"+current());
      int status=c.getResponseCode();
      if(status>=300&&status<400){String location=c.getHeaderField("Location");c.disconnect();address=new URL(u,location).toString();continue;}
      if(status!=200){c.disconnect();throw new IOException(status==403||status==429?"GitHub 限制了当前网络的请求，请稍后重试或打开下载页":"GitHub HTTP "+status);}return c;
    }
    throw new IOException("下载重定向过多");
  }
  private String text(String address,int limit) throws Exception {
    HttpURLConnection c=request(address);
    try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
      byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>limit)throw new IOException("更新响应过大");out.write(buffer,0,n);}return out.toString("UTF-8");
    }finally{c.disconnect();}
  }
  synchronized void check() {
    if(busy)return;busy=true;ready=null;readyHash=null;url=null;sums=null;name=null;version=null;state("正在检查更新…",false,-1);
    worker.execute(()->{
      try{
        JSONArray list=new JSONArray(text("https://api.github.com/repos/Yeqi99/CShell/releases?per_page=30",2000000));
        String best=current();boolean compatible=false;
        String selectedUrl=null,selectedSums=null,selectedName=null,selectedVersion=null;long selectedSize=0;
        for(int i=0;i<list.length();i++){
          JSONObject r=list.getJSONObject(i);String tag=r.optString("tag_name");
          if(r.optBoolean("draft")||!tag.matches("v[0-9]+\\.[0-9]+\\.[0-9]+"))continue;
          String expected="CShell-"+tag.substring(1)+"-android-test.apk",base="https://github.com/Yeqi99/CShell/releases/download/"+tag+"/";
          JSONObject apk=null,checksum=null;JSONArray assets=r.getJSONArray("assets");
          for(int j=0;j<assets.length();j++){JSONObject a=assets.getJSONObject(j);if(expected.equals(a.optString("name")))apk=a;if("SHA256SUMS.txt".equals(a.optString("name")))checksum=a;}
          if(apk==null||checksum==null)continue;
          if(!(base+expected).equals(apk.optString("browser_download_url"))||!(base+"SHA256SUMS.txt").equals(checksum.optString("browser_download_url")))throw new IOException("发布附件地址无效");
          long length=apk.getLong("size");if(length<=0||length>150000000)throw new IOException("安装包大小无效");
          compatible=true;if(compare(tag,best)<=0)continue;
          best=tag;selectedVersion=tag.substring(1);selectedName=expected;selectedUrl=base+expected;selectedSums=base+"SHA256SUMS.txt";selectedSize=length;
        }
        url=selectedUrl;sums=selectedSums;name=selectedName;version=selectedVersion;size=selectedSize;
        busy=false;state(!compatible?"尚未找到完整的 Android 安装包":url==null?"当前已是最新可用版本":"发现新版本 "+version,url!=null,-1);
      }catch(Exception e){url=null;busy=false;state("检查失败："+errorMessage(e),false,-1);}
    });
  }
  synchronized void install() {
    if(busy||url==null)return;
    if(ready!=null){launch();return;}
    busy=true;state("正在下载更新…",true,0);
    worker.execute(()->{
      File file=new File(activity.getCacheDir(),"updates/update.apk");
      try{
        String hash=null;
        for(String line:text(sums,100000).split("\\r?\\n")){
          java.util.regex.Matcher m=java.util.regex.Pattern.compile("^([a-fA-F0-9]{64})\\s+\\*?(.+)$").matcher(line);
          if(m.matches()&&name.equals(m.group(2).replaceFirst("^\\./", ""))){if(hash!=null)throw new IOException("校验和重复");hash=m.group(1);}
        }
        if(hash==null)throw new IOException("缺少安装包校验和");
        if(!file.getParentFile().isDirectory()&&!file.getParentFile().mkdirs())throw new IOException("无法创建下载目录");
        HttpURLConnection c=request(url);MessageDigest digest=MessageDigest.getInstance("SHA-256");long done=0;int last=-1;
        try(InputStream in=c.getInputStream();OutputStream out=new FileOutputStream(file)){
          byte[] buffer=new byte[32768];int n;
          while((n=in.read(buffer))!=-1){done+=n;if(done>size)throw new IOException("安装包大小不符");out.write(buffer,0,n);digest.update(buffer,0,n);int progress=(int)(done*100/size);if(progress!=last){last=progress;state("正在下载更新… "+progress+"%",true,progress);}}
        }finally{c.disconnect();}
        StringBuilder actual=new StringBuilder();for(byte b:digest.digest())actual.append(String.format(Locale.ROOT,"%02x",b));
        if(done!=size||!hash.equalsIgnoreCase(actual.toString()))throw new IOException("SHA256 校验失败");
        verifyPackage(file);ready=file;readyHash=hash;busy=false;state("下载已校验，点击安装更新。安装将结束当前会话。",true,100);
      }catch(Exception e){file.delete();ready=null;readyHash=null;busy=false;state("更新失败："+errorMessage(e),true,-1);}
    });
  }
  private String errorMessage(Exception e) {
    if(e instanceof java.net.SocketTimeoutException)return "连接 GitHub 超时，请检查网络后重试或打开下载页";
    if(e instanceof java.net.UnknownHostException || e instanceof java.net.ConnectException)return "无法连接 GitHub，请检查网络后重试或打开下载页";
    return e.getMessage()==null?"更新失败，请重试":e.getMessage();
  }
  @SuppressWarnings("deprecation")
  private void verifyPackage(File file) throws Exception {
    PackageManager pm=activity.getPackageManager();
    int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
    PackageInfo downloaded=pm.getPackageArchiveInfo(file.getAbsolutePath(),flags),installed=pm.getPackageInfo(activity.getPackageName(),flags);
    if(downloaded==null||!activity.getPackageName().equals(downloaded.packageName))throw new IOException("安装包身份无效");
    if(!version.equals(downloaded.versionName))throw new IOException("安装包版本与发布版本不一致");
    long next=Build.VERSION.SDK_INT>=28?downloaded.getLongVersionCode():downloaded.versionCode;
    long current=Build.VERSION.SDK_INT>=28?installed.getLongVersionCode():installed.versionCode;
    if(next<=current)throw new IOException("安装包版本未递增");
    android.content.pm.Signature[] a=Build.VERSION.SDK_INT>=28?downloaded.signingInfo.getApkContentsSigners():downloaded.signatures;
    android.content.pm.Signature[] b=Build.VERSION.SDK_INT>=28?installed.signingInfo.getApkContentsSigners():installed.signatures;
    if(!Arrays.equals(a,b))throw new IOException("此预览版签名与已安装版本不同，无法覆盖更新。请从 GitHub 手动安装；卸载会清除本地配置");
  }
  private void launch() {
    busy=true;state("正在核对安装包…",true,-1);
    worker.execute(()->{
      try{
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try(InputStream in=new FileInputStream(ready)){byte[] buffer=new byte[32768];int n;while((n=in.read(buffer))!=-1)digest.update(buffer,0,n);}
        StringBuilder actual=new StringBuilder();for(byte b:digest.digest())actual.append(String.format(Locale.ROOT,"%02x",b));
        if(readyHash==null||!readyHash.equalsIgnoreCase(actual.toString())){ready=null;throw new IOException("安装包已变化，请重新下载");}
        verifyPackage(ready);
      }catch(Exception e){ready=null;readyHash=null;busy=false;state("无法安装："+errorMessage(e),true,-1);return;}
      activity.runOnUiThread(()->{
        busy=false;
        try{
        if(!activity.getPackageManager().canRequestPackageInstalls()){
          state("请允许 CShell 安装更新，返回后再次点击安装。",true,-1);
          activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+activity.getPackageName())));return;
        }
        Uri uri=FileProvider.getUriForFile(activity,activity.getPackageName()+".updates",ready);
        Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        activity.startActivity(intent);state("已打开系统安装程序；取消后可再次点击安装。",true,-1);
      }catch(Exception e){state("无法安装："+e.getMessage(),true,-1);}
      });
    });
  }
}
