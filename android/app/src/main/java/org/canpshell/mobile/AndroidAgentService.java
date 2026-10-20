package org.canpshell.mobile;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.media.projection.*;
import android.os.*;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import org.json.JSONObject;
import java.util.concurrent.*;

/** User-started, visible screen-sharing service; no persisted projection consent or silent restart. */
public final class AndroidAgentService extends Service {
  static final String CHANGED="org.canpshell.mobile.CAGENT_STATUS",STOP="org.canpshell.mobile.CAGENT_STOP";
  private static volatile AndroidAgentService current;
  private static volatile String lastError="";
  private static volatile boolean starting;
  private final ExecutorService worker=Executors.newSingleThreadExecutor();
  private volatile AndroidAgentHost host;
  private volatile AndroidScreenCapture capture;
  private MediaProjection projection;
  private volatile AndroidAgentHost.Events viewer;
  private volatile boolean sharing,destroying;
  private volatile JSONObject format;
  private int sourceWidth,sourceHeight;
  static void starting(Context context,boolean value,String error){starting=value;lastError=error;changed(context);}
  static void changed(Context context){context.sendBroadcast(new Intent(CHANGED).setPackage(context.getPackageName()));}
  static JSONObject status(Context context) {
    try{
      JSONObject result=AndroidAgentSettings.read(context);
      AndroidAgentService live=current;
      return result.put("supported",Build.VERSION.SDK_INT>=29).put("running",live!=null&&live.host!=null&&live.host.status().optBoolean("running")&&live.sharing)
        .put("sharing",live!=null&&live.sharing).put("accessibilityEnabled",AndroidControlService.isAvailable())
        .put("starting",starting).put("error",lastError);
    }catch(Exception e){return error(e);}
  }
  static JSONObject error(Exception e){try{return new JSONObject().put("error",e.getMessage()==null?"CAgent 操作失败":e.getMessage());}catch(Exception ignored){return new JSONObject();}}
  static JSONObject configure(Context context,String json){
    try{
      if(json.length()>4096)throw new IllegalArgumentException("设置过长");
      JSONObject before=AndroidAgentSettings.read(context),after=AndroidAgentSettings.update(context,new JSONObject(json));
      boolean disconnect=!after.getBoolean("enabled")||before.getInt("port")!=after.getInt("port")||!before.getString("password").equals(after.getString("password"));
      if(disconnect){context.stopService(new Intent(context,AndroidAgentService.class));starting=false;}
      lastError="";changed(context);return status(context);
    }catch(Exception e){return error(e);}
  }
  static JSONObject connection(Context context)throws Exception{
    JSONObject settings=AndroidAgentSettings.read(context);
    String address=settings.getString("advertisedHost");
    if(address.isEmpty())throw new IllegalArgumentException("请先填写其他设备能够访问的 IP 或域名");
    AndroidAgentService live=current;
    if(live==null||live.host==null||!live.sharing||!live.host.status().optBoolean("running"))throw new IllegalStateException("请等待屏幕共享服务启动");
    int port=settings.getInt("advertisedPort");if(port==0)port=settings.getInt("port");
    return live.host.connectionInfo(address,port);
  }
  @Override public void onCreate(){super.onCreate();current=this;}
  @Override public IBinder onBind(Intent intent){return null;}
  @Override public int onStartCommand(Intent intent,int flags,int id){
    if(intent==null||STOP.equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}
    if(sharing||projection!=null){starting=false;changed(this);return START_NOT_STICKY;}
    try{
      JSONObject settings=AndroidAgentSettings.read(this);
      if(!settings.getBoolean("enabled")||settings.getString("password").isEmpty())throw new IllegalStateException("请启用 CAgent 并设置连接密码");
      NotificationManager manager=getSystemService(NotificationManager.class);
      manager.createNotificationChannel(new NotificationChannel("cagent-sharing","CAgent 屏幕共享",NotificationManager.IMPORTANCE_LOW));
      PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
      PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,AndroidAgentService.class).setAction(STOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
      Notification notification=new Notification.Builder(this,"cagent-sharing").setSmallIcon(android.R.drawable.ic_menu_view)
        .setContentTitle("CAgent 屏幕共享已开启").setContentText("已认证的 CShell 可以连接此手机；点停止结束共享")
        .setContentIntent(open).setOngoing(true).addAction(new Notification.Action.Builder(null,"停止共享",stop).build()).build();
      if(Build.VERSION.SDK_INT>=29)startForeground(7107,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
      else startForeground(7107,notification);
      Intent consent=intent.getParcelableExtra("consent");
      if(consent==null)throw new IllegalArgumentException("缺少屏幕共享授权");
      projection=getSystemService(MediaProjectionManager.class).getMediaProjection(intent.getIntExtra("result",Activity.RESULT_CANCELED),consent);
      if(projection==null)throw new IllegalStateException("屏幕共享未获授权");
      worker.execute(()->{
        try{startHost(settings);starting=false;lastError="";changed(this);}
        catch(Exception e){fail(e.getMessage());}
      });
    }catch(Exception e){fail(e.getMessage());}
    return START_NOT_STICKY;
  }
  private void startHost(JSONObject settings)throws Exception{
    if(destroying)return;
    DisplayMetrics metrics=new DisplayMetrics();getSystemService(WindowManager.class).getDefaultDisplay().getRealMetrics(metrics);
    sourceWidth=metrics.widthPixels;sourceHeight=metrics.heightPixels;
    capture=new AndroidScreenCapture();
    capture.start(projection,sourceWidth,sourceHeight,30,6_000_000,new AndroidScreenCapture.Listener(){
      public void onFormat(int width,int height){format=capture.metadata();AndroidAgentHost.Events listener=viewer;if(listener!=null)listener.video(format);}
      public void onFrame(byte[] bytes,long time,boolean key){AndroidAgentHost.Events listener=viewer;if(listener!=null)listener.frame(bytes,time,key);}
      public void onError(String reason){fail(reason);}
      public void onStopped(){if(sharing)fail("屏幕共享已结束，请在手机上重新授权");}
    });
    sharing=true;
    host=new AndroidAgentHost(this,new AndroidAgentHost.Backend(){
      public boolean available(){return sharing&&!destroying;}
      public boolean controlAvailable(){return sharing&&AndroidControlService.isAvailable();}
      public void start(JSONObject quality,AndroidAgentHost.Events listener)throws Exception{
        if(!available())throw new IllegalStateException("屏幕共享未开启");
        viewer=listener;capture.quality(quality);JSONObject info=format;if(info!=null)listener.video(info);capture.requestKeyFrame();
      }
      public void stop(){viewer=null;AndroidControlService.releaseAll();}
      public void input(JSONObject event)throws Exception{if(!controlAvailable()||!AndroidControlService.dispatch(event))throw new IllegalStateException("Android 输入尚未就绪或不支持此操作");}
      public void releaseInput(){AndroidControlService.releaseAll();}
      public void requestKeyFrame(){capture.requestKeyFrame();}
      public void quality(JSONObject quality)throws Exception{capture.quality(quality);}
    });
    host.start(settings.getInt("port"),settings.getString("password"));
  }
  private void fail(String reason){
    if(destroying)return;
    lastError=reason==null?"屏幕共享停止":reason;starting=false;sharing=false;
    AndroidAgentHost.Events listener=viewer;if(listener!=null)listener.error(lastError);
    changed(this);stopSelf();
  }
  @Override public void onConfigurationChanged(Configuration config){
    super.onConfigurationChanged(config);
    if(Build.VERSION.SDK_INT<34&&capture!=null){DisplayMetrics metrics=new DisplayMetrics();getSystemService(WindowManager.class).getDefaultDisplay().getRealMetrics(metrics);capture.resize(metrics.widthPixels,metrics.heightPixels);}
  }
  @Override public void onDestroy(){
    destroying=true;sharing=false;starting=false;viewer=null;
    if(current==this)current=null;
    worker.execute(()->{if(host!=null)host.close();if(capture!=null)capture.stop();if(projection!=null)projection.stop();AndroidControlService.releaseAll();});
    worker.shutdown();stopForeground(STOP_FOREGROUND_REMOVE);changed(this);super.onDestroy();
  }
}
