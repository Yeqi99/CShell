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
      button=new Button(app);button.setText("CAgent native input fixture");button.setOnClickListener(v->clicks.incrementAndGet());panel.addView(button,new LinearLayout.LayoutParams(-1,80));
      editor=new EditText(app);editor.setSingleLine(true);editor.setHint("Native text fixture");panel.addView(editor,new LinearLayout.LayoutParams(-1,80));
      FrameLayout.LayoutParams placement=new FrameLayout.LayoutParams(-1,180);placement.topMargin=120;
      ((FrameLayout)app.findViewById(android.R.id.content)).addView(panel,placement);
    });
  }
  void awaitReady()throws Exception{long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);while(!AndroidControlService.isAvailable()&&System.nanoTime()<end)Thread.sleep(50);check(AndroidControlService.isAvailable(),"Accessibility service did not bind");}
  String verify(AgentConnection connection)throws Exception {
    tap(connection,button);long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);while(clicks.get()==0&&System.nanoTime()<end)Thread.sleep(50);check(clicks.get()==1,"Remote native tap did not click fixture button; "+AndroidControlService.editState());
    // Queue clicks without waiting for gesture callbacks. Each accepted click
    // must run once; the service must not silently drop input while busy.
    for(int i=0;i<3;i++)tap(connection,button);
    end=System.nanoTime()+TimeUnit.SECONDS.toNanos(8);
    while(clicks.get()<4&&System.nanoTime()<end)Thread.sleep(25);
    check(clicks.get()==4,"Rapid remote taps lost or duplicated; clicks="+clicks.get()+", "+AndroidControlService.editState());
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
    return "PASS encrypted remote input → real Accessibility tap, editable text, scan-code letter, repeated/Unicode/selection backspace\n";
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
