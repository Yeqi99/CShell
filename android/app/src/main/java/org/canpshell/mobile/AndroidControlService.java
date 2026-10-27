package org.canpshell.mobile;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.os.Bundle;
import android.os.Handler;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import org.json.JSONObject;

/** Explicitly enabled Android accessibility controls; not a privileged input injector. */
public final class AndroidControlService extends AccessibilityService {
  private static volatile AndroidControlService instance;
  private android.os.HandlerThread inputThread;
  private Handler inputHandler;
  private float x=.5f,y=.5f;
  private Path drag;
  private long downAt;
  private int points;
  private final java.util.ArrayDeque<JSONObject> queue=new java.util.ArrayDeque<>();
  private boolean pending;
  private volatile boolean gestureBusy;
  private volatile String gestureState="idle";
  private long gestureSequence;
  private volatile boolean editBusy;
  private boolean shiftLeft,shiftRight,control,alt,caps;
  private static volatile String lastEditState="none";
  private volatile long processed;
  private volatile String phase="idle";
  static String editState(){AndroidControlService s=instance;return lastEditState+(s==null?", disconnected":", processed="+s.processed+", phase="+s.phase+", editing="+s.editBusy+", gesture="+s.gestureState);}
  static boolean isEditing(){AndroidControlService s=instance;return s!=null&&s.editBusy;}
  @Override protected void onServiceConnected(){inputThread=new android.os.HandlerThread("cagent-accessibility-input");inputThread.start();inputHandler=new Handler(inputThread.getLooper());instance=this;AndroidAgentService.changed(this);}
  @Override public void onAccessibilityEvent(AccessibilityEvent event){}
  @Override public void onInterrupt(){releaseAll();}
  @Override public void onDestroy(){if(instance==this)instance=null;synchronized(this){queue.clear();}if(inputThread!=null)inputThread.quitSafely();AndroidAgentService.changed(this);super.onDestroy();}
  static boolean isAvailable(){return instance!=null;}
  /** Returns queued, not proof that a target application accepted the action. */
  static boolean dispatch(JSONObject event){
    AndroidControlService service=instance;if(service==null)return false;
    String kind=event.optString("kind");
    if(kind.equals("lease"))return true;
    synchronized(service){
      if(kind.equals("move")&&!service.queue.isEmpty()&&service.queue.peekLast().optString("kind").equals("move"))service.queue.removeLast();
      if(service.queue.size()>=128)return false;
      service.queue.addLast(event);
      if(service.pending)return true;
      service.pending=true;
    }
    service.inputHandler.post(service::drainInputs);return true;
  }
  private void drainInputs(){
    if(instance!=this)return;
    if(editBusy||gestureBusy){inputHandler.postDelayed(this::drainInputs,16);return;}
    for(int n=0;n<16;n++){JSONObject event;synchronized(this){event=queue.pollFirst();if(event==null){pending=false;return;}}apply(event);if(editBusy||gestureBusy){inputHandler.postDelayed(this::drainInputs,16);return;}}
    inputHandler.post(this::drainInputs);
  }
  static void releaseAll(){AndroidControlService s=instance;if(s!=null){synchronized(s){s.queue.clear();}s.inputHandler.post(s::reset);}}
  private void reset(){drag=null;points=0;downAt=0;shiftLeft=false;shiftRight=false;control=false;alt=false;}
  private float px(float value,boolean horizontal){
    android.util.DisplayMetrics dm=new android.util.DisplayMetrics();
    ((android.view.WindowManager)getSystemService(WINDOW_SERVICE)).getDefaultDisplay().getRealMetrics(dm);
    return Math.max(0,Math.min((horizontal?dm.widthPixels:dm.heightPixels)-1,value*(horizontal?dm.widthPixels:dm.heightPixels)));
  }
  private static float normalized(double value){if(!Double.isFinite(value)||value<0||value>1)throw new IllegalArgumentException("Invalid pointer coordinate");return (float)value;}
  private void apply(JSONObject value){
    processed++;phase=value.optString("kind");
    try {
      switch(value.optString("kind")){
        case "move":
          x=normalized(value.getDouble("x"));y=normalized(value.getDouble("y"));
          if(drag!=null&&points++<2048)drag.lineTo(px(x,true),px(y,false));break;
        case "button":
          int button=value.optInt("button");
          if(button==0){
            if(value.optBoolean("down")){drag=new Path();drag.moveTo(px(x,true),px(y,false));downAt=android.os.SystemClock.uptimeMillis();points=1;}
            else if(drag!=null){Path path=drag;long duration=Math.min(points>1?500:1500,Math.max(40,android.os.SystemClock.uptimeMillis()-downAt));reset();gesture(path,duration);}
          } else if(button==1&&!value.optBoolean("down")) { // Existing CShell clients map secondary button to 1.
            Path path=new Path();path.moveTo(px(x,true),px(y,false));gesture(path,650);
          }
          break;
        case "wheel":
          int delta=value.optInt("delta");if(delta==0)break;
          boolean horizontal=value.optBoolean("horizontal");float end=Math.max(.05f,Math.min(.95f,(horizontal?x:y)+(delta>0?.25f:-.25f)));
          Path path=new Path();path.moveTo(px(x,true),px(y,false));path.lineTo(px(horizontal?end:x,true),px(horizontal?y:end,false));gesture(path,180);break;
        case "text": insert(value.optString("text"));break;
        case "key":
          key(value.optInt("code"),value.optBoolean("down"));break;
        case "global":
          String action=value.optString("action");
          if(action.equals("back"))performGlobalAction(GLOBAL_ACTION_BACK);
          else if(action.equals("home"))performGlobalAction(GLOBAL_ACTION_HOME);
          else if(action.equals("recents"))performGlobalAction(GLOBAL_ACTION_RECENTS);
          break;
      }
    }catch(Exception error){lastEditState="input-error:"+error.getClass().getSimpleName();reset();}finally{phase="idle";}
  }
  private void key(int code,boolean down){
    if(code==42){shiftLeft=down;return;}if(code==54){shiftRight=down;return;}
    if(code==29||code==0x11d){control=down;return;}if(code==56||code==0x138){alt=down;return;}
    if(!down)return;
    if(code==1){performGlobalAction(GLOBAL_ACTION_BACK);return;}
    if(code==0x15b||code==0x15c){performGlobalAction(GLOBAL_ACTION_HOME);return;}
    if(code==58){caps=!caps;return;}
    if(code==14){backspace();return;}
    if(code==28&&!control&&!alt){
      AccessibilityNodeInfo node=focused();if(node==null)return;
      try{if(node.isEditable()&&!node.isPassword()){
        if(android.os.Build.VERSION.SDK_INT>=30)node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.getId());
      }}finally{node.recycle();}return;
    }
    if(control||alt)return;
    boolean shift=shiftLeft||shiftRight;char letter=0;
    if(code>=16&&code<=25)letter="qwertyuiop".charAt(code-16);
    if(code>=30&&code<=38)letter="asdfghjkl".charAt(code-30);
    if(code>=44&&code<=50)letter="zxcvbnm".charAt(code-44);
    if(letter!=0){insert(String.valueOf(shift^caps?Character.toUpperCase(letter):letter));return;}
    if(code>=2&&code<=11){insert(String.valueOf((shift?"!@#$%^&*()":"1234567890").charAt(code-2)));return;}
    int[] codes={12,13,26,27,39,40,41,43,51,52,53,57};
    String normal="-=[];'`\\,./ ",upper="_+{}:\"~|<>? ";
    for(int i=0;i<codes.length;i++)if(code==codes[i]){insert(String.valueOf((shift?upper:normal).charAt(i)));return;}
    // System shortcuts and arbitrary scan codes cannot be injected by Accessibility.
  }
  private void gesture(Path path,long duration){
    if(gestureBusy)throw new IllegalStateException("Gesture queue was not serialized");
    final long sequence=++gestureSequence;
    gestureBusy=true;gestureState="submitted";
    final Runnable watchdog=()->{
      if(sequence!=gestureSequence||!gestureBusy)return;
      // No completion is not proof of failure: discard dependent input, never
      // replay an uncertain click or release stale queued actions on a new app.
      gestureState="completion-unknown";gestureBusy=false;
      synchronized(this){queue.clear();}reset();
    };
    inputHandler.postDelayed(watchdog,Math.max(5000,duration+2000));
    try{
      boolean accepted=dispatchGesture(new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(path,0,duration)).build(),new GestureResultCallback(){
        private void finish(String outcome){
          if(sequence!=gestureSequence||!gestureBusy)return;
          inputHandler.removeCallbacks(watchdog);gestureState=outcome;gestureBusy=false;
        }
        @Override public void onCompleted(GestureDescription g){finish("completed");}
        @Override public void onCancelled(GestureDescription g){finish("cancelled");}
      },inputHandler);
      if(!accepted){inputHandler.removeCallbacks(watchdog);gestureState="rejected";gestureBusy=false;}
    }catch(RuntimeException error){
      inputHandler.removeCallbacks(watchdog);gestureState="dispatch-error";gestureBusy=false;throw error;
    }
  }
  private AccessibilityNodeInfo focused(){
    // Android 10 can temporarily return no global input focus while the IME
    // updates. Only fall back to a focused application window's actual input
    // focus, never an arbitrary editable field or a remembered node.
    for(int attempt=0;attempt<4;attempt++){
      AccessibilityNodeInfo node=findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
      if(node!=null){if(node.refresh()&&node.isFocused())return node;node.recycle();}
      for(android.view.accessibility.AccessibilityWindowInfo window:getWindows()){
        try{
          if(window.getType()!=android.view.accessibility.AccessibilityWindowInfo.TYPE_APPLICATION||!window.isFocused())continue;
          AccessibilityNodeInfo root=window.getRoot();if(root==null)continue;
          try{node=root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);if(node!=null){if(node.refresh()&&node.isFocused())return node;node.recycle();}}finally{root.recycle();}
        }finally{window.recycle();}
      }
      android.os.SystemClock.sleep(24);
    }
    return null;
  }
  private void insert(String text){
    if(text.length()>4096)return;AccessibilityNodeInfo node=focused();if(node==null)return;
    try{if(!node.isEditable()||node.isPassword())return;String old=node.isShowingHintText()||node.getText()==null?"":node.getText().toString();if(old.length()>1_000_000)return;
      int start=node.getTextSelectionStart(),end=node.getTextSelectionEnd();if(start<0||end<0){start=old.length();end=start;}int lo=Math.min(start,end),hi=Math.max(start,end);if(hi>old.length())return;
      Bundle args=new Bundle();args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,old.substring(0,lo)+text+old.substring(hi));
      if(node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,args))settleEdit(node,old.substring(0,lo)+text+old.substring(hi),lo+text.length());
    }finally{node.recycle();}
  }
  private void backspace(){AccessibilityNodeInfo node=focused();if(node==null){lastEditState="backspace:no-input-focus";return;}
    try{
      if(!node.isEditable()||node.isPassword()){lastEditState="backspace:not-editable";return;}
      String old=node.isShowingHintText()||node.getText()==null?"":node.getText().toString();
      int a=node.getTextSelectionStart(),b=node.getTextSelectionEnd();
      // Missing selection is not permission to guess a deletion position.
      if(a<0||b<0||a>old.length()||b>old.length()){lastEditState="backspace:invalid-selection:"+a+":"+b+":"+old.length();return;}
      int lo=Math.min(a,b),hi=Math.max(a,b);
      if(lo==hi&&lo==0){lastEditState="backspace:at-start";return;}
      if(lo==hi)lo=old.offsetByCodePoints(lo,-1);
      Bundle args=new Bundle();args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,old.substring(0,lo)+old.substring(hi));
      if(!node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,args)){lastEditState="backspace:text-rejected";return;}
      settleEdit(node,old.substring(0,lo)+old.substring(hi),lo);
    }finally{node.recycle();}}
  // Accessibility text and selection snapshots can lag independently on older
  // Android releases. Do not consume the next input until this edit's caret is
  // confirmed on the same node; never move focus or overwrite a newer edit.
  private void settleEdit(AccessibilityNodeInfo original,String expected,int caret){
    editBusy=true;AccessibilityNodeInfo node=AccessibilityNodeInfo.obtain(original);
    inputHandler.post(new Runnable(){int attempts;
      public void run(){
        boolean retry=false;
        try{
          if(instance!=AndroidControlService.this||!node.refresh()||!node.isFocused())return;
          String actual=node.getText()==null?"":node.getText().toString();
          if(actual.equals(expected)){
            if(node.getTextSelectionStart()==caret&&node.getTextSelectionEnd()==caret){lastEditState="edit:applied";return;}
            Bundle selection=new Bundle();selection.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT,caret);selection.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT,caret);
            node.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION,selection);
          }
          retry=++attempts<8;
          if(!retry)lastEditState="edit:caret-unconfirmed";
        }finally{if(retry)inputHandler.postDelayed(this,32);else{node.recycle();editBusy=false;}}
      }
    });
  }
}



