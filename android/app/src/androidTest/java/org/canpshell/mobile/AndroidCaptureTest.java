package org.canpshell.mobile;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.media.MediaCodec;
import android.media.MediaFormat;
import android.os.Build;
import android.util.Base64;
import android.view.accessibility.AccessibilityNodeInfo;
import org.json.JSONObject;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Real emulator-only screen sharing consent, encoder, pinned TLS transport and native decoder. */
final class AndroidCaptureTest {
  static String run(Instrumentation test)throws Exception {
    check(Build.HARDWARE.equals("ranchu")||Build.HARDWARE.equals("goldfish"),"Capture acceptance is emulator-only");
    Context context=test.getTargetContext();
    JSONObject previous=AndroidAgentSettings.read(context);
    String password="capture-"+java.util.UUID.randomUUID();
    int port;try(java.net.ServerSocket reserve=new java.net.ServerSocket(0)){port=reserve.getLocalPort();}
    MainActivity activity=null;
    AndroidInputTest inputFixture=null;
    android.os.Handler compositor=new android.os.Handler(android.os.Looper.getMainLooper());
    AtomicInteger markerUpdates=new AtomicInteger();
    AtomicReference<android.view.View> marker=new AtomicReference<>();
    try {
      context.stopService(new Intent(context,AndroidAgentService.class));Thread.sleep(300);
      AndroidAgentSettings.update(context,new JSONObject().put("enabled",true).put("port",port).put("password",password).put("advertisedHost","127.0.0.1").put("advertisedPort",port));
      activity=(MainActivity)test.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      MainActivity app=activity;
      test.runOnMainSync(()->{app.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);app.new Bridge().cagentStart();});
      approveProjection(test);
      long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(20);
      while((!AndroidAgentService.status(context).optBoolean("running")||!AndroidAgentService.status(context).optBoolean("sharing"))&&System.nanoTime()<deadline){Thread.sleep(100);String error=AndroidAgentService.status(context).optString("error");check(error.isEmpty(),error);}
      check(AndroidAgentService.status(context).optBoolean("sharing"),"Screen-sharing service did not start: "+captureState(context));
      check(AndroidAgentService.status(context).optBoolean("interactive")&&!AndroidAgentService.status(context).optBoolean("screenLocked"),"Capture fixture must be awake and unlocked: "+captureState(context));
      JSONObject invitation=AndroidAgentService.connection(context);
      // Produce genuine compositor changes instead of relying on an otherwise static home screen.
      test.runOnMainSync(()->{
        android.view.View square=new android.view.View(app);
        ((android.widget.FrameLayout)app.findViewById(android.R.id.content)).addView(square,new android.widget.FrameLayout.LayoutParams(64,64));
        marker.set(square);
        // CI disables animator duration scaling. Drive real View invalidations directly;
        // ValueAnimator would finish immediately and leave the compositor static there.
        compositor.post(new Runnable(){public void run(){
          square.setBackgroundColor((markerUpdates.incrementAndGet()&1)==0?0xff0055ff:0xffff5500);
          compositor.postDelayed(this,100);
        }});
      });
      inputFixture=new AndroidInputTest(test,app);inputFixture.awaitReady();
      StringBuilder result=new StringBuilder("PASS real Android system screen-sharing consent and foreground service\n");
      for(int attempt=0;attempt<2;attempt++){
        if(attempt==1){check(test.getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES).setRotation(android.app.UiAutomation.ROTATION_FREEZE_90),"Emulator rotation request failed");Thread.sleep(700);}
        AtomicReference<Throwable> failure=new AtomicReference<>();AtomicInteger decoded=new AtomicInteger(),received=new AtomicInteger(),formats=new AtomicInteger(),inputWaits=new AtomicInteger();AtomicBoolean pixels=new AtomicBoolean();AtomicInteger width=new AtomicInteger(),height=new AtomicInteger();CountDownLatch frames=new CountDownLatch(4);
        final int markerStart=markerUpdates.get(),decodeAttempt=attempt+1;
        AtomicReference<MediaCodec> decoder=new AtomicReference<>();final AgentConnection[] reference=new AgentConnection[1];
        reference[0]=new AgentConnection((type,value)->{
          try {
            if(type.equals("desktop-video")){
              formats.incrementAndGet();
              JSONObject video=new JSONObject(value);check(video.getString("codec").startsWith("avc1."),"Missing actual AVC codec");
              width.set(video.getInt("width"));height.set(video.getInt("height"));
              MediaCodec old=decoder.getAndSet(null);if(old!=null){old.stop();old.release();}
              MediaCodec fresh=MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC);
              fresh.configure(MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC,width.get(),height.get()),null,null,0);fresh.start();decoder.set(fresh);
            }
            if(type.equals("desktop-frame")){
              received.incrementAndGet();
              JSONObject frame=new JSONObject(value);byte[] data=Base64.decode(frame.getString("data"),Base64.DEFAULT);
              check(data.length>4&&data[0]==0&&data[1]==0,"Frame not Annex-B H264");
              MediaCodec current=decoder.get();check(current!=null,"Frame arrived before video metadata");
              // This is a synchronous test decoder, not the production WebCodecs renderer.
              // A late output can occupy all buffers: release it before asking for more input.
              // INFO_TRY_AGAIN_LATER is transient backpressure, not a decoder failure.
              drainDecoder(current,decoded,frames,pixels,0);
              long inputDeadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
              int input;
              while((input=current.dequeueInputBuffer(0))<0){
                inputWaits.incrementAndGet();
                check(System.nanoTime()<inputDeadline,"Decoder input unavailable after 3 seconds; attempt="+decodeAttempt+", codec="+current.getName()+", received="+received.get()+", decoded="+decoded.get()+", formats="+formats.get()+", inputWaits="+inputWaits.get()+", size="+width.get()+"x"+height.get());
                drainDecoder(current,decoded,frames,pixels,10000);
              }
              ByteBuffer buffer=current.getInputBuffer(input);check(buffer!=null,"Decoder input buffer missing");buffer.clear();check(buffer.remaining()>=data.length,"Decoder input too small");buffer.put(data);
              current.queueInputBuffer(input,0,data.length,frame.getLong("timestamp"),0);
              drainDecoder(current,decoded,frames,pixels,10000);
              reference[0].queueDesktopCommand(new JSONObject().put("op","ack").put("id",frame.getString("id")).toString());
            }
            if(type.equals("error")){failure.compareAndSet(null,new Exception(value));while(frames.getCount()>0)frames.countDown();}
          }catch(Throwable e){failure.compareAndSet(null,e);while(frames.getCount()>0)frames.countDown();}
        });
        try {
          reference[0].connect("127.0.0.1",port,attempt==0?password:"",certificate->{try{return java.util.Arrays.equals(certificate,java.security.cert.CertificateFactory.getInstance("X.509").generateCertificate(new java.io.ByteArrayInputStream(invitation.getString("certificate").getBytes(java.nio.charset.StandardCharsets.US_ASCII))).getEncoded());}catch(Exception e){return false;}});
          reference[0].desktop(new JSONObject().put("fps",attempt==0?24:15).put("bitrate",attempt==0?2_000_000:1_000_000).put("adaptive",false).put("display",0).put("width",attempt==0?480:320).put("height",attempt==0?800:534),attempt==0);
          check(frames.await(25,TimeUnit.SECONDS),"No 4 decoded frames within 25 seconds; attempt="+(attempt+1)+", received="+received.get()+", decoded="+decoded.get()+", formats="+formats.get()+", markerUpdates="+(markerUpdates.get()-markerStart)+", size="+width.get()+"x"+height.get()+", "+captureState(context));if(failure.get()!=null)throw new Exception("Capture decode failed; attempt="+decodeAttempt+", received="+received.get()+", decoded="+decoded.get()+", formats="+formats.get()+", inputWaits="+inputWaits.get()+", markerUpdates="+(markerUpdates.get()-markerStart)+", size="+width.get()+"x"+height.get()+", "+captureState(context),failure.get());
          check(decoded.get()>=4,"Expected decoded pixel frames");check(pixels.get(),"Decoded screen contained no visible luma variation");check(width.get()>0&&height.get()>0,"Invalid video size");
          if(attempt==0)result.append(inputFixture.verify(reference[0]));
          if(attempt==1){check(width.get()<=320,"Quality reconfiguration did not change output size");check(width.get()>height.get(),"Rotation did not update capture aspect ratio");}
          result.append("PASS MediaProjection → H264 → pinned TLS → native decode attempt ").append(attempt+1).append(": ").append(decoded.get()).append(" frames ").append(width.get()).append('x').append(height.get()).append("; inputWaits=").append(inputWaits.get()).append('\n');
        }finally{reference[0].close();Thread.sleep(300);MediaCodec old=decoder.getAndSet(null);if(old!=null){try{old.stop();}catch(Exception ignored){}old.release();}}
        Thread.sleep(300);
      }
      context.stopService(new Intent(context,AndroidAgentService.class));
      deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);while(AndroidAgentService.status(context).optBoolean("running")&&System.nanoTime()<deadline)Thread.sleep(50);
      check(!AndroidAgentService.status(context).optBoolean("running"),"Service still sharing after stop");
      boolean closed=false;for(int n=0;n<30;n++){try(java.net.Socket socket=new java.net.Socket()){socket.connect(new java.net.InetSocketAddress("127.0.0.1",port),100);}catch(java.io.IOException expected){closed=true;break;}Thread.sleep(100);}
      check(closed,"Listener still accepting after stop");return result.append("PASS sharing stop closes TCP listener\nOK (actual Android capture, H264 decode, same-consent reconnect, quality resize, stop)").toString();
    }finally{context.stopService(new Intent(context,AndroidAgentService.class));if(inputFixture!=null)inputFixture.close();test.getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES).setRotation(android.app.UiAutomation.ROTATION_FREEZE_0);test.getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES).setRotation(android.app.UiAutomation.ROTATION_UNFREEZE);AndroidAgentSettings.update(context,previous);MainActivity app=activity;if(app!=null)test.runOnMainSync(()->{compositor.removeCallbacksAndMessages(null);app.getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);android.view.View square=marker.get();if(square!=null&&square.getParent() instanceof android.view.ViewGroup)((android.view.ViewGroup)square.getParent()).removeView(square);app.finish();});}
  }
  /** Release all available output, including delayed frames, without waiting indefinitely. */
  private static void drainDecoder(MediaCodec current,AtomicInteger decoded,CountDownLatch frames,AtomicBoolean pixels,long timeoutUs){
    MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
    for(int n=0;n<8;n++){
      int out=current.dequeueOutputBuffer(info,timeoutUs);
      if(out==MediaCodec.INFO_TRY_AGAIN_LATER)return;
      if(out<0)continue;
      try {
        if(info.size>0){
          android.media.Image image=current.getOutputImage(out);
          if(image!=null)try{
            android.media.Image.Plane plane=image.getPlanes()[0];ByteBuffer luma=plane.getBuffer();int low=255,high=0;
            for(int y=0;y<image.getHeight();y+=7)for(int x=0;x<image.getWidth();x+=7){int at=y*plane.getRowStride()+x*plane.getPixelStride();if(at<luma.limit()){int v=luma.get(at)&255;low=Math.min(low,v);high=Math.max(high,v);}}
            if(high-low>16)pixels.set(true);
          }finally{image.close();}
          decoded.incrementAndGet();frames.countDown();
        }
      }finally{current.releaseOutputBuffer(out,false);}
    }
  }
  private static String captureState(Context context){
    // status also contains configuration: only expose bounded, non-secret diagnostics.
    JSONObject state=AndroidAgentService.status(context);
    return "running="+state.optBoolean("running")+", sharing="+state.optBoolean("sharing")+", interactive="+state.optBoolean("interactive")+", locked="+state.optBoolean("screenLocked")+", needsConsent="+state.optBoolean("needsProjectionConsent");
  }
  private static void approveProjection(Instrumentation test)throws Exception {
    long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(15);
    while(System.nanoTime()<until){
      AccessibilityNodeInfo root=test.getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES).getRootInActiveWindow();
      if(root!=null)try{
        String owner=String.valueOf(root.getPackageName());
        if(owner.equals("com.android.systemui")||owner.equals("android")){
          List<AccessibilityNodeInfo> buttons=root.findAccessibilityNodeInfosByViewId("android:id/button1");
          for(AccessibilityNodeInfo button:buttons){try{String text=String.valueOf(button.getText()).toLowerCase(java.util.Locale.ROOT);if(button.isEnabled()&&(text.contains("start")||text.contains("share")||text.contains("开始")||text.contains("共享"))&&button.performAction(AccessibilityNodeInfo.ACTION_CLICK))return;}finally{button.recycle();}}
        }
      }finally{root.recycle();}
      Thread.sleep(200);
    }
    throw new AssertionError("System projection consent button not found (no permission bypass)");
  }
  private static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
}
