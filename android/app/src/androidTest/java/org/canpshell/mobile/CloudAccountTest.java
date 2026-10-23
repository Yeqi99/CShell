package org.canpshell.mobile;
import android.content.*;
import org.json.*;
import java.lang.reflect.*;
import java.util.*;
final class CloudAccountTest {
 static Object call(CloudSync c,String name,Class<?>[] types,Object... args)throws Exception{Method m=CloudSync.class.getDeclaredMethod(name,types);m.setAccessible(true);return m.invoke(c,args);}
 static void set(CloudSync c,String name,Object value)throws Exception{Field f=CloudSync.class.getDeclaredField(name);f.setAccessible(true);f.set(c,value);}
 static Object get(CloudSync c,String name)throws Exception{Field f=CloudSync.class.getDeclaredField(name);f.setAccessible(true);return f.get(c);}
 static void check(boolean value,String detail){if(!value)throw new AssertionError(detail);}
 static String run(Context original)throws Exception{
  String prefix="cloud-account-test-"+UUID.randomUUID();
  Context context=new ContextWrapper(original){@Override public SharedPreferences getSharedPreferences(String n,int m){return super.getSharedPreferences(prefix+"-"+n,m);}};
  try{
   String id=UUID.randomUUID().toString();
   JSONObject profile=new JSONObject().put("id",id).put("name","fixture").put("host","test.invalid").put("port",22).put("username","user").put("auth","password");
   JSONObject bundle=new JSONObject().put("format",1).put("store",new JSONObject().put("profiles",new JSONArray().put(profile)).put("secrets",new JSONObject().put(id,new JSONObject().put("password","fixture-secret")))).put("ai",new JSONObject().put("providers",new JSONArray()).put("policy",new JSONObject().put("future",true))).put("devices",new JSONArray()).put("opencode",new JSONObject().put("accounts",new JSONArray())).put("future-field","keep");
   CloudSync a=new CloudSync(context);JSONObject state=new JSONObject().put("session",new JSONObject().put("accountId","a").put("email","a@example.com")).put("key","fixture-key").put("bundle",bundle).put("pending",new JSONObject().put("mutationId","pending-id")).put("pendingBundle",bundle);
   set(a,"state",state);call(a,"archive",new Class<?>[]{});set(a,"state",new JSONObject());call(a,"save",new Class<?>[]{});
   CloudSync guest=new CloudSync(context);check(guest.owner().equals("guest"),"guest context");JSONObject request=new JSONObject(profile.toString()).put("cloudProfileId",id);guest.fillCredentials(request);check(!request.has("password"),"guest credential isolation");
   JSONObject accounts=(JSONObject)get(guest,"accounts"),cached=accounts.getJSONObject("a");check(!cached.has("session")&&!cached.has("key"),"archive cannot authenticate");check(cached.getJSONObject("pending").getString("mutationId").equals("pending-id"),"pending preserved");check(cached.getJSONObject("bundle").getString("future-field").equals("keep"),"unknown fields retained");check(cached.getJSONObject("bundle").getJSONObject("ai").has("policy"),"policy retained");
   set(guest,"state",new JSONObject().put("session",new JSONObject().put("accountId","b").put("email","b@example.com")).put("key","b-key"));call(guest,"save",new Class<?>[]{});CloudSync b=new CloudSync(context);check(b.owner().equals("b"),"account B restart");b.fillCredentials(request);check(!request.has("password"),"B cannot read A credentials");
   cached.put("session",new JSONObject().put("accountId","a").put("email","a@example.com")).put("key","fixture-key");set(b,"state",cached);b.fillCredentials(request);check(request.getString("password").equals("fixture-secret"),"same-account credential restore");
   return "OK: native encrypted account archive, pending writes, guest/B isolation, same-account credentials and unknown fields\n";
  }finally{original.deleteSharedPreferences(prefix+"-cloud-sync");}
 }
}
