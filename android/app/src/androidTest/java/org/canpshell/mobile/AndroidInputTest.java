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
  private final java.util.ArrayDeque<String> touchTrace=new java.util.ArrayDeque<>();
  private void trace(String event){synchronized(touchTrace){if(touchTrace.size()==48)touchTrace.removeFirst();touchTrace.addLast(android.os.SystemClock.uptimeMillis()+":"+event);}}
  private String inputDiagnostics(){synchronized(touchTrace){return AndroidControlService.editState()+", nativeTouches="+touchTrace;}}
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
      editor=new EditText(app);editor.setSingleLine(true);editor.setHint("Native text fixture");panel.addView(editor,new LinearLayout.LayoutParams(-1,80));
      FrameLayout.LayoutParams placement=new FrameLayout.LayoutParams(-1,180);placement.topMargin=120;
      ((FrameLayout)app.findViewById(android.R.id.content)).addView(panel,placement);
    });
  }
  void awaitReady()throws Exception{long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);while(!AndroidControlService.isAvailable()&&System.nanoTime()<end)Thread.sleep(50);check(AndroidControlService.isAvailable(),"Accessibility service did not bind");}
  String verify(AgentConnection connection)throws Exception {
    tap(connection,button);long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);while(clicks.get()==0&&System.nanoTime()<end)Thread.sleep(50);check(clicks.get()==1,"Remote native tap did not click fixture button; "+inputDiagnostics());
    // Queue clicks without waiting for gesture callbacks. Each accepted click
    // must run once; the service must not silently drop input while busy.
    for(int i=0;i<3;i++)tap(connection,button);
    end=System.nanoTime()+TimeUnit.SECONDS.toNanos(8);
    while(clicks.get()<4&&System.nanoTime()<end)Thread.sleep(25);
    check(clicks.get()==4,"Rapid remote taps lost or duplicated; clicks="+clicks.get()+", "+inputDiagnostics());
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
    pressBackspace(connection);awaitText("CAgent  check");
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
    return "PASS encrypted remote input → real Accessibility tap, editable text, scan-code letter, repeated/Unicode/selection backspace, held Shift across tap, fail-stop gesture outcomes and fresh input recovery\n";
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
    UiAutomation automation=test.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);automation.adoptShellPermissionIdentity(android.Manifest.permission.WRITE_SECURE_SETTINGS);
    try {Settings.Secure.putString(app.getContentResolver(),Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,previousServices);Settings.Secure.putString(app.getContentResolver(),Settings.Secure.ACCESSIBILITY_ENABLED,previousEnabled);}finally{automation.dropShellPermissionIdentity();}
    test.runOnMainSync(()->{if(panel!=null&&panel.getParent() instanceof ViewGroup)((ViewGroup)panel.getParent()).removeView(panel);});
  }
  private static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
}
