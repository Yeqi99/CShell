package org.canpshell.mobile;

import android.app.Instrumentation;
import android.app.UiAutomation;
import android.provider.Settings;
import android.widget.*;
import android.view.*;
import org.json.JSONObject;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.*;

/** Emulator-only real Accessibility service acceptance, with original secure settings restored. */
final class AndroidInputTest implements AutoCloseable {
  private final Instrumentation test;
  private final MainActivity app;
  private final String previousServices,previousEnabled;
  private LinearLayout panel;
  private Button button;
  private EditText editor;
  private final AtomicInteger clicks=new AtomicInteger();
  private final AtomicBoolean delayedNativeCaret=new AtomicBoolean();
  private final java.util.ArrayDeque<String> touchTrace=new java.util.ArrayDeque<>();
  private final java.util.ArrayDeque<String> editStacks=new java.util.ArrayDeque<>();
  private final java.util.concurrent.ScheduledExecutorService sampler=java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
  private void trace(String event){synchronized(touchTrace){if(touchTrace.size()==48)touchTrace.removeFirst();touchTrace.addLast(android.os.SystemClock.uptimeMillis()+":"+event);}}
  private String inputDiagnostics(){synchronized(touchTrace){synchronized(editStacks){return AndroidControlService.editState()+", nativeTouches="+touchTrace+", editStacks="+editStacks;}}}
  AndroidInputTest(Instrumentation test,MainActivity app)throws Exception {
    this.test=test;this.app=app;
    if(!android.os.Build.HARDWARE.equals("ranchu")&&!android.os.Build.HARDWARE.equals("goldfish"))throw new IllegalStateException("Emulator only");
    previousServices=Settings.Secure.getString(app.getContentResolver(),Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
    previousEnabled=Settings.Secure.getString(app.getContentResolver(),Settings.Secure.ACCESSIBILITY_ENABLED);
    UiAutomation automation=test.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
    automation.adoptShellPermissionIdentity(android.Manifest.permission.WRITE_SECURE_SETTINGS);
    try {
      String component=app.getPackageName()+"/org.canpshell.mobile.AndroidControlService";
      Settings.Secure.putString(app.getContentResolver(),Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,previousServices==null||previousServices.isEmpty()?component:previousServices+":"+component);
      Settings.Secure.putInt(app.getContentResolver(),Settings.Secure.ACCESSIBILITY_ENABLED,1);
    }finally{automation.dropShellPermissionIdentity();}
    // Android 10 shares one AccessibilityInteractionClient node cache inside
    // this process. Retaining UiAutomation's separate accessibility connection
    // while the actual service edits our native view cross-contaminates cached
    // connection IDs and causes five-second refresh/action timeouts. The test
    // driver no longer needs accessibility after granting the real service.
    // All following taps/edits still travel through TLS and AndroidControlService.
    if(android.os.Build.VERSION.SDK_INT>=31){
      test.getUiAutomation(UiAutomation.FLAG_DONT_USE_ACCESSIBILITY|UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
    }else{
      // API29 delivers cache-maintenance events even with eventTypes=0.
      // Destroy only the instrumentation driver's connection via its TestApi;
      // retaining that connection deadlocks its shared node cache against the
      // application's main thread. No product permission/service is changed.
      UiAutomation.class.getMethod("destroy").invoke(automation);
      boolean disconnected=false;
      try{automation.getServiceInfo();}catch(IllegalStateException expected){disconnected=true;}
      check(disconnected,"Test driver remained connected");
    }
    sampler.scheduleAtFixedRate(()->{
      if(!AndroidControlService.isEditing())return;
      StackTraceElement[] stack=android.os.Looper.getMainLooper().getThread().getStackTrace();
      StringBuilder value=new StringBuilder().append(android.os.SystemClock.uptimeMillis());
      for(int i=0;i<Math.min(stack.length,16);i++)value.append(" > ").append(stack[i]);
      for(java.util.Map.Entry<Thread,StackTraceElement[]> entry:Thread.getAllStackTraces().entrySet()){
        if(entry.getKey()==android.os.Looper.getMainLooper().getThread())continue;
        boolean relevant=false;for(StackTraceElement frame:entry.getValue())if(frame.getClassName().contains("AccessibilityInteractionClient")||frame.getClassName().contains("AccessibilityCache")){relevant=true;break;}
        if(relevant){value.append(" [thread=").append(entry.getKey().getName()).append(",state=").append(entry.getKey().getState());for(int i=0;i<Math.min(entry.getValue().length,22);i++)value.append(" > ").append(entry.getValue()[i]);value.append(']');}
      }
      synchronized(editStacks){if(editStacks.size()>=8)editStacks.removeFirst();editStacks.addLast(value.toString());}
    },500,500,TimeUnit.MILLISECONDS);
    test.runOnMainSync(()->{
      panel=new LinearLayout(app);panel.setOrientation(LinearLayout.VERTICAL);panel.setBackgroundColor(0xffffffff);
      button=new Button(app){
        @Override public boolean dispatchTouchEvent(MotionEvent event){
          // Observe the actual native target without consuming or manufacturing
          // events. Never record production input, text, or screen contents.
          trace("touch="+MotionEvent.actionToString(event.getActionMasked())+", eventTime="+event.getEventTime()+", downTime="+event.getDownTime()+", x="+event.getX()+", y="+event.getY()+", windowFocus="+hasWindowFocus());
          boolean handled=super.dispatchTouchEvent(event);trace("handled="+handled);return handled;
        }
      };button.setText("CAgent native input fixture");button.setOnClickListener(v->{trace("click="+clicks.incrementAndGet());});panel.addView(button,new LinearLayout.LayoutParams(-1,80));
      editor=new EditText(app){@Override protected void onSelectionChanged(int start,int end){super.onSelectionChanged(start,end);trace("selection="+start+":"+end);}};editor.setSingleLine(true);editor.setHint("Native text fixture");panel.addView(editor,new LinearLayout.LayoutParams(-1,80));
      editor.addTextChangedListener(new android.text.TextWatcher(){
        public void beforeTextChanged(CharSequence s,int start,int count,int after){}
        public void onTextChanged(CharSequence s,int start,int before,int count){}
        public void afterTextChanged(android.text.Editable text){
          if(delayedNativeCaret.getAndSet(false))editor.postDelayed(()->editor.setSelection(editor.length()),40);
        }
      });
      FrameLayout.LayoutParams placement=new FrameLayout.LayoutParams(-1,180);placement.topMargin=120;
      ((FrameLayout)app.findViewById(android.R.id.content)).addView(panel,placement);
    });
  }
  void awaitReady()throws Exception{long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);while(!AndroidControlService.isAvailable()&&System.nanoTime()<end)Thread.sleep(50);check(AndroidControlService.isAvailable(),"Accessibility service did not bind");}
  String verify(AgentConnection connection)throws Exception {
    long initialEvents=serviceEventRevision();
    verifyGestureSettling();
    tap(connection,button);long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);while(clicks.get()==0&&System.nanoTime()<end)Thread.sleep(50);check(clicks.get()==1,"Remote native tap did not click fixture button; "+inputDiagnostics());
    // Queue clicks without waiting for gesture callbacks. Each accepted click
    // must run once; the service must not silently drop input while busy.
    // Reproduce burst boundaries repeatedly inside one connection. Any failed
    // batch fails the run; there is no retry or replacement of lost clicks.
    for(int batch=0;batch<8;batch++){
      int expected=1+(batch+1)*3;
      for(int i=0;i<3;i++)tap(connection,button);
      end=System.nanoTime()+TimeUnit.SECONDS.toNanos(8);
      while(clicks.get()<expected&&System.nanoTime()<end)Thread.sleep(25);
      check(clicks.get()==expected,"Rapid remote taps lost or duplicated; batch="+batch+", expected="+expected+", clicks="+clicks.get()+", "+inputDiagnostics());
    }
    tap(connection,editor);AtomicBoolean focused=new AtomicBoolean();end=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
    while(!focused.get()&&System.nanoTime()<end){test.runOnMainSync(()->focused.set(editor.hasFocus()));Thread.sleep(50);}check(focused.get(),"Remote tap did not focus editor");
    input(connection,new JSONObject().put("kind","text").put("text","CAgent input check"));
    awaitText("CAgent input check");
    input(connection,new JSONObject().put("kind","key").put("code",30).put("down",true));
    input(connection,new JSONObject().put("kind","key").put("code",30).put("down",false));
    awaitText("CAgent input checka");
    input(connection,new JSONObject().put("kind","key").put("code",14).put("down",true));
    input(connection,new JSONObject().put("kind","key").put("code",14).put("down",false));
    awaitText("CAgent input check");
    // A second delete catches cursor reset after ACTION_SET_TEXT; a surrogate pair
    // must be removed as one code point rather than leaving invalid UTF-16 behind.
    input(connection,new JSONObject().put("kind","text").put("text","\ud83d\ude00x"));
    awaitText("CAgent input check\ud83d\ude00x");
    pressBackspace(connection);awaitText("CAgent input check\ud83d\ude00");
    pressBackspace(connection);awaitText("CAgent input check");
    test.runOnMainSync(()->editor.setSelection(7,12));
    // Reproduce the native posted end-selection after ACTION_SET_TEXT. The next
    // edit must use the confirmed middle caret, not append at the stale end.
    delayedNativeCaret.set(true);
    pressBackspace(connection);awaitText("CAgent  check");
    AtomicReference<String> middleCaret=new AtomicReference<>();
    test.runOnMainSync(()->middleCaret.set(editor.getSelectionStart()+":"+editor.getSelectionEnd()));
    check(middleCaret.get().equals("7:7")&&AndroidControlService.editState().startsWith("edit:applied"),
      "Middle caret was not confirmed before next input: "+middleCaret.get()+", "+inputDiagnostics());
    input(connection,new JSONObject().put("kind","text").put("text","input"));
    awaitText("CAgent input check");
    // A pointer release is not a keyboard release: keep Shift until key-up.
    input(connection,new JSONObject().put("kind","key").put("code",42).put("down",true));
    tap(connection,editor);
    input(connection,new JSONObject().put("kind","key").put("code",30).put("down",true));
    input(connection,new JSONObject().put("kind","key").put("code",30).put("down",false));
    input(connection,new JSONObject().put("kind","key").put("code",42).put("down",false));
    awaitText("CAgent input checkA");pressBackspace(connection);awaitText("CAgent input check");
    for(String outcome:new String[]{"cancelled","rejected","dispatch-error","completion-unknown"}){
      failQueuedGesture(outcome);
      input(connection,new JSONObject().put("kind","text").put("text","Z"));
      awaitText("CAgent input checkZ");pressBackspace(connection);awaitText("CAgent input check");
    }
    failUnconfirmedEdit();
    awaitText("CAgent input check");
    input(connection,new JSONObject().put("kind","text").put("text","Z"));
    awaitText("CAgent input checkZ");pressBackspace(connection);awaitText("CAgent input check");
    long actualEvents=serviceEventRevision()-initialEvents;
    check(actualEvents>0,"Product accessibility event path did not receive native edit events");
    AtomicReference<android.webkit.WebView> semantic=new AtomicReference<>();
    test.runOnMainSync(()->{
      android.webkit.WebView view=new android.webkit.WebView(app);view.getSettings().setJavaScriptEnabled(true);
      ((FrameLayout)app.findViewById(android.R.id.content)).addView(view,new FrameLayout.LayoutParams(-1,100));semantic.set(view);
      view.loadDataWithBaseURL(null,"<html><body><button>CAgent semantic page one</button></body></html>","text/html","UTF-8",null);
    });
    try{
      awaitSemanticText("CAgent semantic page one","CAgent semantic page two");
      test.runOnMainSync(()->semantic.get().evaluateJavascript("document.body.innerHTML='<button>CAgent semantic page two</button>'",null));
      awaitSemanticText("CAgent semantic page two","CAgent semantic page one");
    }finally{test.runOnMainSync(()->{android.webkit.WebView view=semantic.get();((ViewGroup)view.getParent()).removeView(view);view.destroy();});}
    return "PASS encrypted remote input → real Accessibility tap, editable text, scan-code letter, repeated/Unicode/selection backspace, held Shift across tap, fail-stop gesture outcomes, fresh input recovery and current semantic content; productEvents="+actualEvents+"\n";
  }
  private void awaitSemanticText(String expected,String stale)throws Exception {
    long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);boolean found=false,old=false;
    do{
      org.json.JSONArray nodes=AndroidControlService.snapshot().getJSONArray("nodes");found=false;old=false;
      for(int i=0;i<nodes.length();i++){String text=nodes.getJSONObject(i).optString("text");found|=text.equals(expected);old|=text.equals(stale);}
      if(found&&!old)return;
      Thread.sleep(50);
    }while(System.nanoTime()<end);
    throw new AssertionError("Current semantic content missing or stale: found="+found+", stale="+old);
  }
  private long serviceEventRevision()throws Exception {
    java.lang.reflect.Field instance=AndroidControlService.class.getDeclaredField("instance");instance.setAccessible(true);
    Object service=instance.get(null);check(service!=null,"Product accessibility service disconnected");
    java.lang.reflect.Field revision=AndroidControlService.class.getDeclaredField("editRevision");revision.setAccessible(true);
    return ((java.util.concurrent.atomic.AtomicLong)revision.get(service)).get();
  }
  private void verifyGestureSettling()throws Exception {
    Class<AndroidControlService> type=AndroidControlService.class;
    java.lang.reflect.Field instance=type.getDeclaredField("instance");instance.setAccessible(true);
    AndroidControlService service=(AndroidControlService)instance.get(null);check(service!=null,"Service disconnected");
    java.lang.reflect.Field handlerField=type.getDeclaredField("inputHandler");handlerField.setAccessible(true);
    android.os.Handler handler=(android.os.Handler)handlerField.get(service);
    java.lang.reflect.Field sequence=type.getDeclaredField("gestureSequence");sequence.setAccessible(true);
    java.lang.reflect.Field busy=type.getDeclaredField("gestureBusy");busy.setAccessible(true);
    java.lang.reflect.Method settle=type.getDeclaredMethod("settleGesture",long.class);settle.setAccessible(true);
    java.util.concurrent.CountDownLatch done=new java.util.concurrent.CountDownLatch(1);AtomicReference<Throwable> failure=new AtomicReference<>();
    handler.post(()->{try{
      check(!busy.getBoolean(service),"Previous gesture still active");long token=sequence.getLong(service)+1;sequence.setLong(service,token);busy.setBoolean(service,true);
      final long started=android.os.SystemClock.uptimeMillis();settle.invoke(service,token);
      check(busy.getBoolean(service),"Injection completion released input before settling");
      handler.post(new Runnable(){public void run(){try{
        long elapsed=android.os.SystemClock.uptimeMillis()-started;
        if(busy.getBoolean(service)){check(elapsed<2000,"Settling did not end");handler.postDelayed(this,10);return;}
        check(elapsed>=android.view.ViewConfiguration.getPressedStateDuration()+32,"Gesture released before real-clock settle deadline");
      }catch(Throwable error){failure.set(error);}done.countDown();}});
    }catch(Throwable error){failure.set(error);done.countDown();}});
    check(done.await(5,TimeUnit.SECONDS),"Gesture settling check timed out");if(failure.get()!=null)throw new AssertionError("Gesture settling failed",failure.get());
  }
  private void failUnconfirmedEdit()throws Exception {
    Class<AndroidControlService> type=AndroidControlService.class;
    java.lang.reflect.Field instance=type.getDeclaredField("instance");instance.setAccessible(true);
    AndroidControlService service=(AndroidControlService)instance.get(null);check(service!=null,"Service disconnected");
    java.lang.reflect.Field handlerField=type.getDeclaredField("inputHandler");handlerField.setAccessible(true);
    android.os.Handler handler=(android.os.Handler)handlerField.get(service);
    java.lang.reflect.Method focused=type.getDeclaredMethod("focused");focused.setAccessible(true);
    java.lang.reflect.Method settle=type.getDeclaredMethod("settleEdit",android.view.accessibility.AccessibilityNodeInfo.class,String.class,int.class);settle.setAccessible(true);
    java.util.concurrent.CountDownLatch queued=new java.util.concurrent.CountDownLatch(1);
    AtomicReference<Throwable> failure=new AtomicReference<>();
    handler.post(()->{
      android.view.accessibility.AccessibilityNodeInfo node=null;
      try{
        node=(android.view.accessibility.AccessibilityNodeInfo)focused.invoke(service);check(node!=null,"Fixture has no native focus");
        // A stale/unconfirmed snapshot must not allow dependent input through.
        // This only injects the expected snapshot, not a synthetic edit result.
        settle.invoke(service,node,"UNCONFIRMED-TEST-SNAPSHOT",0);
        check(AndroidControlService.dispatch(new JSONObject().put("kind","text").put("text","SHOULD-NOT-TYPE")),"Queue rejected fixture");
      }catch(Throwable error){failure.set(error);}finally{if(node!=null)node.recycle();queued.countDown();}
    });
    check(queued.await(10,TimeUnit.SECONDS),"Edit injection timed out");
    if(failure.get()!=null)throw new AssertionError("Edit injection failed",failure.get());
    long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
    while(AndroidControlService.isEditing()&&System.nanoTime()<end)Thread.sleep(25);
    check(!AndroidControlService.isEditing(),"Unconfirmed edit remained busy");
    check(AndroidControlService.editState().contains("edit:caret-unconfirmed"),"Expected caret timeout: "+AndroidControlService.editState());
  }
  // Fault injection stays in androidTest: no production bypass or test endpoint.
  // Real OS acceptance is exercised above; here we deterministically inject its
  // four failure outcomes on the actual service input thread and native editor.
  private void failQueuedGesture(String outcome)throws Exception {
    Class<AndroidControlService> type=AndroidControlService.class;
    java.lang.reflect.Field instance=type.getDeclaredField("instance");instance.setAccessible(true);
    AndroidControlService service=(AndroidControlService)instance.get(null);check(service!=null,"Service disconnected");
    java.lang.reflect.Field handlerField=type.getDeclaredField("inputHandler");handlerField.setAccessible(true);
    android.os.Handler handler=(android.os.Handler)handlerField.get(service);
    java.lang.reflect.Field sequence=type.getDeclaredField("gestureSequence");sequence.setAccessible(true);
    java.lang.reflect.Field busy=type.getDeclaredField("gestureBusy");busy.setAccessible(true);
    java.lang.reflect.Method finish=type.getDeclaredMethod("finishGesture",long.class,String.class);finish.setAccessible(true);
    java.util.concurrent.CountDownLatch done=new java.util.concurrent.CountDownLatch(1);
    AtomicReference<Throwable> failure=new AtomicReference<>();
    handler.post(()->{
      try{
        check(!busy.getBoolean(service),"Previous gesture still active");
        long token=sequence.getLong(service)+1;sequence.setLong(service,token);busy.setBoolean(service,true);
        check(AndroidControlService.dispatch(new JSONObject().put("kind","text").put("text","SHOULD-NOT-TYPE")),"Queue rejected fixture");
        finish.invoke(service,token-1,"completed");check(busy.getBoolean(service),"Stale callback released new gesture");
        handler.postDelayed(()->{
          try{finish.invoke(service,token,outcome);check(!busy.getBoolean(service),"Failure did not unblock queue");}
          catch(Throwable error){failure.set(error);}finally{done.countDown();}
        },80);
      }catch(Throwable error){failure.set(error);done.countDown();}
    });
    check(done.await(10,TimeUnit.SECONDS),"Fault outcome timed out: "+outcome);
    if(failure.get()!=null)throw new AssertionError("Gesture fault injection failed: "+outcome,failure.get());
  }
  private static void pressBackspace(AgentConnection connection)throws Exception {
    input(connection,new JSONObject().put("kind","key").put("code",14).put("down",true));
    input(connection,new JSONObject().put("kind","key").put("code",14).put("down",false));
  }
  private void awaitText(String expected)throws Exception {AtomicReference<String> actual=new AtomicReference<>("");AtomicReference<String> selection=new AtomicReference<>("");long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(15);while((!expected.equals(actual.get())||AndroidControlService.isEditing())&&System.nanoTime()<end){test.runOnMainSync(()->{actual.set(editor.getText().toString());selection.set(editor.getSelectionStart()+":"+editor.getSelectionEnd()+", focused="+editor.hasFocus());});Thread.sleep(50);}check(expected.equals(actual.get()),"Remote edit mismatch: "+actual.get()+", expected="+expected+", selection="+selection.get()+", service="+AndroidControlService.editState());}
  private void tap(AgentConnection connection,View target)throws Exception {
    AtomicReference<double[]> point=new AtomicReference<>();test.runOnMainSync(()->{int[] at=new int[2];target.getLocationOnScreen(at);android.util.DisplayMetrics metrics=new android.util.DisplayMetrics();app.getSystemService(WindowManager.class).getDefaultDisplay().getRealMetrics(metrics);point.set(new double[]{(at[0]+target.getWidth()/2.0)/metrics.widthPixels,(at[1]+target.getHeight()/2.0)/metrics.heightPixels});});
    input(connection,new JSONObject().put("kind","move").put("x",point.get()[0]).put("y",point.get()[1]));
    input(connection,new JSONObject().put("kind","button").put("button",0).put("down",true));
    input(connection,new JSONObject().put("kind","button").put("button",0).put("down",false));
  }
  private static void input(AgentConnection connection,JSONObject value)throws Exception {connection.queueDesktopCommand(new JSONObject().put("op","input").put("value",value).toString());}
  public void close(){
    sampler.shutdownNow();
    UiAutomation automation=test.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);automation.adoptShellPermissionIdentity(android.Manifest.permission.WRITE_SECURE_SETTINGS);
    try {Settings.Secure.putString(app.getContentResolver(),Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,previousServices);Settings.Secure.putString(app.getContentResolver(),Settings.Secure.ACCESSIBILITY_ENABLED,previousEnabled);}finally{automation.dropShellPermissionIdentity();}
    test.runOnMainSync(()->{if(panel!=null&&panel.getParent() instanceof ViewGroup)((ViewGroup)panel.getParent()).removeView(panel);});
  }
  private static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
}
