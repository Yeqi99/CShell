package org.canpshell.mobile;

import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaFormat;
import android.media.projection.MediaProjection;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.view.Surface;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.concurrent.ArrayBlockingQueue;

/** One user-authorized projection; reconfiguration resizes the existing virtual display. */
final class AndroidScreenCapture {
  interface Listener {
    void onFormat(int width, int height);
    void onFrame(byte[] annexB, long timestampUs, boolean keyframe);
    void onError(String error);
    void onStopped();
  }
  private final HandlerThread thread = new HandlerThread("CAgent-capture");
  private final ArrayBlockingQueue<Frame> delivery = new ArrayBlockingQueue<>(1);
  private Handler handler;
  private MediaProjection projection;
  private MediaCodec codec;
  private Surface surface;
  private VirtualDisplay display;
  private Listener listener;
  private Thread sender;
  private volatile boolean running, needsKey = true;
  private boolean closed; private long lastKeyRequest;
  private byte[] config = new byte[0];
  private int width, height, sourceWidth, sourceHeight, targetFps, targetBitrate, targetWidth, targetHeight, actualFps;
  private volatile int generation;
  private String encoderName="", codecName="avc1.42E01E";
  private boolean hardware;
  private static final class Frame {
    final byte[] data; final long time; final boolean key; final int generation;
    Frame(byte[] d,long t,boolean k,int g){data=d;time=t;key=k;generation=g;}
  }
  private final MediaProjection.Callback callback = new MediaProjection.Callback() {
    @Override public void onStop(){ fail("PROJECTION_STOPPED: screen sharing was stopped by Android or the user"); }
    @Override public void onCapturedContentResize(int w,int h){
      if(running && w>1 && h>1 && (w!=sourceWidth || h!=sourceHeight)) {
        sourceWidth=w;sourceHeight=h;
        try{reconfigure();}catch(Exception e){fail("PROJECTION_RESIZE_FAILED: "+e.getMessage());}
      }
    }
  };
  synchronized void start(MediaProjection source,int requestedWidth,int requestedHeight,int fps,int bitrate,Listener receiver) {
    if(handler!=null)throw new IllegalStateException("Capture instances are single use");
    if(source==null || requestedWidth<2 || requestedHeight<2 || fps<1 || bitrate<1)throw new IllegalArgumentException("Invalid capture parameters");
    listener=receiver;projection=source;sourceWidth=requestedWidth;sourceHeight=requestedHeight;targetFps=fps;targetBitrate=bitrate;thread.start();handler=new Handler(thread.getLooper());
    handler.post(()->{
      try {
        configureEncoder(sourceWidth,sourceHeight);
        projection.registerCallback(callback,handler);
        display=projection.createVirtualDisplay("CAgent remote display",width,height,android.content.res.Resources.getSystem().getDisplayMetrics().densityDpi,DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,surface,null,handler);
        running=true;
        sender=new Thread(()->{
          try {while(running){Frame f=delivery.take();if(running&&f.generation==generation)listener.onFrame(f.data,f.time,f.key);}}
          catch(InterruptedException e){Thread.currentThread().interrupt();}
          catch(Exception e){handler.post(()->fail("FRAME_DELIVERY_FAILED: "+e.getMessage()));}
        },"CAgent-frame-delivery");sender.start();handler.post(drain);
      }catch(Exception e){fail("CAPTURE_FAILED: "+e.getMessage());}
    });
  }
  private void configureEncoder(int desiredWidth,int desiredHeight)throws Exception {
    String name=null;MediaCodecList encoders=new MediaCodecList(MediaCodecList.REGULAR_CODECS);
    while(desiredWidth>=2&&desiredHeight>=2){
      MediaFormat probe=MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC,desiredWidth,desiredHeight);
      probe.setInteger(MediaFormat.KEY_COLOR_FORMAT,MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
      name=encoders.findEncoderForFormat(probe);if(name!=null)break;
      desiredWidth=(int)(desiredWidth*.75)/2*2;desiredHeight=(int)(desiredHeight*.75)/2*2;
    }
    if(name==null)throw new IllegalStateException("No surface H264 encoder supports this display size");
    codec=MediaCodec.createByCodecName(name);encoderName=name;
    hardware=android.os.Build.VERSION.SDK_INT>=29&&codec.getCodecInfo().isHardwareAccelerated();
    MediaCodecInfo.VideoCapabilities caps=codec.getCodecInfo().getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC).getVideoCapabilities();
    width=Math.max(caps.getWidthAlignment(),desiredWidth/caps.getWidthAlignment()*caps.getWidthAlignment());
    height=Math.max(caps.getHeightAlignment(),desiredHeight/caps.getHeightAlignment()*caps.getHeightAlignment());
    actualFps=(int)Math.max(1,Math.min(targetFps,caps.getSupportedFrameRatesFor(width,height).getUpper()));
    MediaFormat format=MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC,width,height);
    format.setInteger(MediaFormat.KEY_COLOR_FORMAT,MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
    format.setInteger(MediaFormat.KEY_BIT_RATE,caps.getBitrateRange().clamp(targetBitrate));
    format.setInteger(MediaFormat.KEY_FRAME_RATE,actualFps);
    format.setFloat(MediaFormat.KEY_MAX_FPS_TO_ENCODER,actualFps);
    format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL,1);
    if(android.os.Build.VERSION.SDK_INT>=29)format.setInteger(MediaFormat.KEY_MAX_B_FRAMES,0);
    format.setInteger(MediaFormat.KEY_PRIORITY,0);
    codec.configure(format,null,null,MediaCodec.CONFIGURE_FLAG_ENCODE);
    surface=codec.createInputSurface();codec.start();
  }
  private void reconfigure()throws Exception {
    generation++;delivery.clear();needsKey=true;config=new byte[0];
    display.setSurface(null);codec.stop();codec.release();codec=null;surface.release();surface=null;
    double scale=Math.min(targetWidth>1?(double)targetWidth/sourceWidth:1,targetHeight>1?(double)targetHeight/sourceHeight:1);
    configureEncoder(Math.max(2,(int)(sourceWidth*scale)),Math.max(2,(int)(sourceHeight*scale)));
    display.resize(width,height,android.content.res.Resources.getSystem().getDisplayMetrics().densityDpi);display.setSurface(surface);
  }
  void resize(int w,int h){Handler current=handler;if(current!=null)current.post(()->{if(running&&w>1&&h>1&&(w!=sourceWidth||h!=sourceHeight)){sourceWidth=w;sourceHeight=h;try{reconfigure();}catch(Exception e){fail("PROJECTION_RESIZE_FAILED: "+e.getMessage());}}});}
  void quality(org.json.JSONObject options){Handler h=handler;if(h!=null)h.post(()->{
    if(!running)return;
    try {
      int fps=options.optInt("fps",targetFps),bitrate=options.optInt("bitrate",targetBitrate),w=options.optInt("width",0),height=options.optInt("height",0);
      if(fps<1||bitrate<1||w<0||height<0)throw new IllegalArgumentException("Invalid quality values");
      boolean resize=fps!=targetFps||w!=targetWidth||height!=targetHeight;
      targetFps=fps;targetBitrate=bitrate;targetWidth=w;targetHeight=height;
      if(resize)reconfigure();else setBitrate(bitrate);
    }catch(Exception e){fail("ENCODER_QUALITY_FAILED: "+e.getMessage());}
  });}
  org.json.JSONObject metadata(){org.json.JSONObject result=new org.json.JSONObject();try {
    result.put("width",width).put("height",height).put("sourceWidth",sourceWidth).put("sourceHeight",sourceHeight).put("fps",actualFps).put("codec",codecName).put("encoder",encoderName).put("hardware",hardware);
  }catch(org.json.JSONException impossible){throw new IllegalStateException(impossible);}return result;}
  private void updateCodecName(){for(int i=0;i+7<config.length;i++)if(config[i]==0&&config[i+1]==0){int offset=config[i+2]==1?i+3:(config[i+2]==0&&config[i+3]==1?i+4:-1);if(offset>=0&&offset+3<config.length&&(config[offset]&31)==7){codecName=String.format(java.util.Locale.ROOT,"avc1.%02X%02X%02X",config[offset+1]&255,config[offset+2]&255,config[offset+3]&255);return;}}}
  private final Runnable drain=new Runnable(){public void run(){
    if(!running)return;
    try {
      MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
      for(int n=0;n<8;n++){
        int index=codec.dequeueOutputBuffer(info,0);
        if(index==MediaCodec.INFO_TRY_AGAIN_LATER)break;
        if(index==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){
          ByteArrayOutputStream bytes=new ByteArrayOutputStream();MediaFormat f=codec.getOutputFormat();
          for(String key:new String[]{"csd-0","csd-1"})if(f.containsKey(key)){ByteBuffer b=f.getByteBuffer(key).duplicate();byte[] data=new byte[b.remaining()];b.get(data);bytes.write(annexB(data));}
          config=bytes.toByteArray();updateCodecName();listener.onFormat(width,height);continue;
        }
        if(index<0)continue;
        byte[] bytes=null;
        try {if(info.size>0){ByteBuffer b=codec.getOutputBuffer(index).duplicate();b.position(info.offset);b.limit(info.offset+info.size);bytes=new byte[info.size];b.get(bytes);}}
        finally {codec.releaseOutputBuffer(index,false);}
        if(bytes==null)continue;
        bytes=annexB(bytes);
        if((info.flags&MediaCodec.BUFFER_FLAG_CODEC_CONFIG)!=0){config=bytes;continue;}
        boolean key=(info.flags&MediaCodec.BUFFER_FLAG_KEY_FRAME)!=0;
        if(needsKey&&!key)continue;
        if(key){ByteArrayOutputStream all=new ByteArrayOutputStream();all.write(config);all.write(bytes);bytes=all.toByteArray();}
        if(!delivery.offer(new Frame(bytes,info.presentationTimeUs,key,generation))){delivery.clear();needsKey=true;requestKeyFrame();}
        else if(key)needsKey=false;
      }
      if(running)handler.postDelayed(this,4);
    }catch(Exception e){fail("ENCODER_FAILED: "+e.getMessage());}
  }};
  /** Android encoders normally emit Annex-B; also normalize length-prefixed output. */
  static byte[] annexB(byte[] source) {
    if(source.length>=4&&source[0]==0&&source[1]==0&&(source[2]==1||(source[2]==0&&source[3]==1)))return source;
    ByteArrayOutputStream result=new ByteArrayOutputStream();int p=0;
    while(p+4<=source.length){int size=ByteBuffer.wrap(source,p,4).getInt();p+=4;if(size<=0||size>source.length-p)throw new IllegalArgumentException("Invalid H264 NAL framing");result.write(0);result.write(0);result.write(0);result.write(1);result.write(source,p,size);p+=size;}
    if(p!=source.length)throw new IllegalArgumentException("Incomplete H264 NAL framing");return result.toByteArray();
  }
  void requestKeyFrame(){Handler h=handler;if(h!=null)h.post(()->{if(running)try{long now=android.os.SystemClock.elapsedRealtime();if(now-lastKeyRequest<250)return;lastKeyRequest=now;Bundle b=new Bundle();b.putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME,0);codec.setParameters(b);}catch(Exception e){fail("ENCODER_KEYFRAME_FAILED: "+e.getMessage());}});}
  void setBitrate(int bitrate){Handler h=handler;if(h!=null)h.post(()->{if(running)try{Bundle b=new Bundle();b.putInt(MediaCodec.PARAMETER_KEY_VIDEO_BITRATE,codec.getCodecInfo().getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC).getVideoCapabilities().getBitrateRange().clamp(bitrate));codec.setParameters(b);}catch(Exception e){fail("ENCODER_QUALITY_FAILED: "+e.getMessage());}});}
  void stop(){Handler h=handler;if(h!=null)h.post(this::close);}
  private void fail(String error){if(closed)return;try{if(listener!=null)listener.onError(error);}finally{close();}}
  private void close(){
    if(closed)return;closed=true;boolean active=projection!=null;running=false;delivery.clear();if(sender!=null)sender.interrupt();
    if(display!=null){try{display.release();}catch(Exception ignored){}display=null;}
    if(codec!=null){try{codec.stop();}catch(Exception ignored){}try{codec.release();}catch(Exception ignored){}codec=null;}
    if(surface!=null){try{surface.release();}catch(Exception ignored){}surface=null;}
    if(projection!=null){MediaProjection old=projection;projection=null;try{old.unregisterCallback(callback);old.stop();}catch(Exception ignored){}}
    try{if(active&&listener!=null)listener.onStopped();}finally{thread.quitSafely();}
  }
}



