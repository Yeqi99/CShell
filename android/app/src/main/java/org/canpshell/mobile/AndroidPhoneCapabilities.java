package org.canpshell.mobile;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.telecom.TelecomManager;
import android.telephony.SmsManager;
import android.telephony.SubscriptionManager;
import android.telephony.TelephonyManager;
import org.json.JSONArray;
import org.json.JSONObject;

/** Optional phone capabilities. Android runtime permissions remain authoritative. */
final class AndroidPhoneCapabilities {
  private final Context context;
  private final SharedPreferences journal;
  AndroidPhoneCapabilities(Context context){this.context=context.getApplicationContext();journal=context.getSharedPreferences("cagent-phone-operations",0);}
  private boolean allowed(String permission){return context.checkSelfPermission(permission)==PackageManager.PERMISSION_GRANTED;}
  private boolean phone(){return context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_TELEPHONY);}
  JSONObject status()throws Exception {
    return new JSONObject().put("telephony",phone()).put("readSms",phone()&&allowed(Manifest.permission.READ_SMS))
      .put("sendSms",phone()&&allowed(Manifest.permission.SEND_SMS)).put("call",phone()&&allowed(Manifest.permission.CALL_PHONE))
      .put("answer",phone()&&allowed(Manifest.permission.ANSWER_PHONE_CALLS))
      .put("defaultSmsSubscription",SubscriptionManager.getDefaultSmsSubscriptionId());
  }
  JSONArray tools()throws Exception {
    JSONArray tools=new JSONArray();
    if(!phone())return tools;
    if(allowed(Manifest.permission.READ_SMS))tools.put(tool("android_sms_read","files.read",false));
    if(allowed(Manifest.permission.SEND_SMS))tools.put(tool("android_sms_send","commands.execute",true));
    if(allowed(Manifest.permission.CALL_PHONE))tools.put(tool("android_call","commands.execute",true));
    if(allowed(Manifest.permission.ANSWER_PHONE_CALLS))tools.put(tool("android_call_answer","commands.execute",true));
    return tools;
  }
  private JSONObject tool(String id,String permission,boolean sideEffect)throws Exception {
    JSONObject properties=new JSONObject();
    JSONArray fields=new JSONArray();String description;
    if(id.equals("android_sms_read")){
      description="Read recent inbox SMS from this Android device only after its READ_SMS permission is granted.";
      properties.put("limit",new JSONObject().put("type","integer").put("minimum",1).put("maximum",50).put("default",20));
      properties.put("after",new JSONObject().put("type","integer").put("minimum",0).put("description","Inclusive Unix timestamp in milliseconds"));
    }else{
      properties.put("requestId",new JSONObject().put("type","string").put("format","uuid").put("description","Unique operation ID; retries with this ID never send or dial twice"));fields.put("requestId");
      if(!id.equals("android_call_answer")){properties.put("number",new JSONObject().put("type","string").put("pattern","^\\+?[0-9]{3,20}$"));fields.put("number");}
      if(id.equals("android_sms_send")){properties.put("text",new JSONObject().put("type","string").put("minLength",1).put("maxLength",1600));fields.put("text");description="Send an SMS from this Android device using its configured default SMS SIM. Requires SEND_SMS. Submitted is not a delivery confirmation.";}
      else if(id.equals("android_call"))description="Place a non-emergency outgoing phone call from this Android device. Requires CALL_PHONE. Never retry an unknown outcome with a new operation ID.";
      else description="Answer the currently ringing phone call on this Android device. Requires ANSWER_PHONE_CALLS; submitted does not confirm connection.";
    }
    return new JSONObject().put("packageId","cagent.android").put("id",id).put("toolId",id).put("description",description)
      .put("inputSchema",new JSONObject().put("type","object").put("properties",properties).put("required",fields).put("additionalProperties",false))
      .put("outputSchema",new JSONObject().put("type","object"))
      .put("permissions",new JSONArray().put(permission)).put("sideEffect",sideEffect);
  }
  private void require(String permission){if(!phone()||!allowed(permission))throw new SecurityException("请在手机上授予此项电话或短信权限");}
  synchronized Object invoke(String owner,String id,JSONObject args)throws Exception {
    if(id.equals("android_sms_read")){
      require(Manifest.permission.READ_SMS);
      int limit=args.optInt("limit",20);if(limit<1||limit>50)throw new IllegalArgumentException("limit must be between 1 and 50");
      long after=args.optLong("after",0);if(after<0)throw new IllegalArgumentException("Invalid timestamp");
      JSONArray items=new JSONArray();
      try(Cursor cursor=context.getContentResolver().query(Uri.parse("content://sms/inbox"),new String[]{"_id","address","body","date","read"},"date >= ?",new String[]{Long.toString(after)},"date DESC")){
        while(cursor!=null&&cursor.moveToNext()&&items.length()<limit)items.put(new JSONObject().put("id",cursor.getString(0)).put("from",cursor.getString(1)).put("body",cursor.getString(2)).put("date",cursor.getLong(3)).put("read",cursor.getInt(4)!=0));
      }
      return new JSONObject().put("messages",items);
    }
    String permission=id.equals("android_sms_send")?Manifest.permission.SEND_SMS:id.equals("android_call")?Manifest.permission.CALL_PHONE:id.equals("android_call_answer")?Manifest.permission.ANSWER_PHONE_CALLS:null;
    if(permission==null)throw new IllegalArgumentException("Unknown Android phone capability");require(permission);
    String request=args.getString("requestId");java.util.UUID.fromString(request);
    String key=owner+":"+request;
    String existing=journal.getString(key,null);
    if(existing!=null)return new JSONObject(existing).put("replayed",false);
    // Retain unknown operations: a reconnect must never redial or resend them.
    if(journal.getAll().size()>=1000)throw new IllegalStateException("电话操作记录已满，请在手机上清理已确认记录");
    String number="",text="";
    if(!id.equals("android_call_answer")){
      number=args.getString("number").trim();if(!number.matches("\\+?[0-9]{3,20}"))throw new IllegalArgumentException("电话号码格式无效");
    }
    if(id.equals("android_sms_send")){text=args.getString("text");if(text.isEmpty()||text.length()>1600)throw new IllegalArgumentException("短信内容需要1至1600字符");}
    if(id.equals("android_call")&&android.os.Build.VERSION.SDK_INT>=29&&context.getSystemService(TelephonyManager.class).isEmergencyNumber(number))throw new IllegalArgumentException("紧急电话请在手机上直接拨打");
    JSONObject state=new JSONObject().put("requestId",request).put("operation",id).put("state","outcome-unknown");
    if(!journal.edit().putString(key,state.toString()).commit())throw new IllegalStateException("无法保存操作记录");
    try{
      if(id.equals("android_sms_send")){
        int subscription=SubscriptionManager.getDefaultSmsSubscriptionId();
        if(!SubscriptionManager.isValidSubscriptionId(subscription))throw new IllegalStateException("请先在手机系统中选择默认短信 SIM 卡");
        SmsManager manager=android.os.Build.VERSION.SDK_INT>=31?context.getSystemService(SmsManager.class).createForSubscriptionId(subscription):SmsManager.getSmsManagerForSubscriptionId(subscription);
        java.util.ArrayList<String> parts=manager.divideMessage(text);
        manager.sendMultipartTextMessage(number,null,parts,null,null);
      }else if(id.equals("android_call"))context.getSystemService(TelecomManager.class).placeCall(Uri.fromParts("tel",number,null),new Bundle());
      else context.getSystemService(TelecomManager.class).acceptRingingCall();
      state.put("state","submitted").put("confirmed",false);
    }catch(SecurityException error){state.put("state","failed").put("error","系统未允许此操作");throw error;}
    catch(Exception error){state.put("state","failed").put("error","电话或短信请求未完成");throw error;}
    finally{journal.edit().putString(key,state.toString()).commit();}
    return state;
  }
}

