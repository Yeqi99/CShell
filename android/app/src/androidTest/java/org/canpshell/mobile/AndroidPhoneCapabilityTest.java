package org.canpshell.mobile;

import android.content.Context;
import android.content.ContextWrapper;
import android.content.pm.PackageManager;
import org.json.JSONObject;

/** Permission denial regression. Never reads SMS or initiates a telephone operation. */
final class AndroidPhoneCapabilityTest {
  static String run(Context context)throws Exception {
    Context denied=new ContextWrapper(context){
      @Override public Context getApplicationContext(){return this;}
      @Override public int checkSelfPermission(String permission){return PackageManager.PERMISSION_DENIED;}
    };
    AndroidPhoneCapabilities capabilities=new AndroidPhoneCapabilities(denied);
    if(capabilities.tools().length()!=0)throw new AssertionError("Denied phone capabilities must not be advertised");
    JSONObject status=capabilities.status();
    for(String field:new String[]{"readSms","sendSms","call","answer"})if(status.getBoolean(field))throw new AssertionError("False permission state: "+field);
    for(String tool:new String[]{"android_sms_read","android_sms_send","android_call","android_call_answer"}){
      try{capabilities.invoke("fixture-owner",tool,new JSONObject());throw new AssertionError("Denied tool executed: "+tool);}
      catch(SecurityException expected){}
    }
    return "OK (Android phone permission denial; no messages read or sent, no calls)";
  }
}
