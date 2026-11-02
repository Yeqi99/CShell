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
   bundle.put("tavily",new JSONObject().put("accounts",new JSONArray().put(new JSONObject().put("id","search").put("key","fixture-search-key").put("enabled",false))));
   check(!CloudSync.supportsSchema2(bundle),"legacy bundle must not raise write schema");
   bundle.getJSONObject("store").put("extensions",new JSONObject().put("enabled",new JSONObject().put("opencode",true)).put("future",new JSONObject().put("keep",true)));
   check(CloudSync.supportsSchema2(bundle),"complete extension selection advertises schema 2");
   check(!CloudSync.supportsSchema2(new JSONObject().put("store",new JSONObject().put("extensions",new JSONObject().put("enabled",new JSONArray())))),"invalid extension representation cannot advertise schema 2");
   CloudSync a=new CloudSync(context);JSONObject state=new JSONObject().put("session",new JSONObject().put("accountId","a").put("email","a@example.com")).put("key","fixture-key").put("bundle",bundle).put("pending",new JSONObject().put("mutationId","pending-id")).put("pendingBundle",bundle);
   set(a,"state",state);call(a,"archive",new Class<?>[]{});set(a,"state",new JSONObject());call(a,"save",new Class<?>[]{});
   CloudSync guest=new CloudSync(context);check(guest.owner().equals("guest"),"guest context");JSONObject request=new JSONObject(profile.toString()).put("cloudProfileId",id);guest.fillCredentials(request);check(!request.has("password"),"guest credential isolation");
   JSONObject accounts=(JSONObject)get(guest,"accounts"),cached=accounts.getJSONObject("a");check(!cached.has("session")&&!cached.has("key"),"archive cannot authenticate");check(cached.getJSONObject("pending").getString("mutationId").equals("pending-id"),"pending preserved");check(cached.getJSONObject("bundle").getString("future-field").equals("keep"),"unknown fields retained");check(cached.getJSONObject("bundle").getJSONObject("ai").has("policy"),"policy retained");
   check(cached.getJSONObject("bundle").getJSONObject("tavily").toString().equals(bundle.getJSONObject("tavily").toString()),"unconsumed Tavily credentials retained");
   set(guest,"state",new JSONObject().put("session",new JSONObject().put("accountId","b").put("email","b@example.com")).put("key","b-key"));call(guest,"save",new Class<?>[]{});CloudSync b=new CloudSync(context);check(b.owner().equals("b"),"account B restart");b.fillCredentials(request);check(!request.has("password"),"B cannot read A credentials");
   cached.put("session",new JSONObject().put("accountId","a").put("email","a@example.com")).put("key","fixture-key");set(b,"state",cached);b.fillCredentials(request);check(request.getString("password").equals("fixture-secret"),"same-account credential restore");
   return "OK: native encrypted account archive, pending writes, guest/B isolation, same-account credentials and unknown fields\n"+enrollment(context);
  }finally{original.deleteSharedPreferences(prefix+"-cloud-sync");}
 }
 static String enrollment(Context context)throws Exception{
   final CloudSync[] ref=new CloudSync[1];final JSONObject[] remote=new JSONObject[1];final long[] revision={7};final int[] writes={0},registered={0};final boolean[] active={true};
   CloudSync cloud=new CloudSync(context,(path,body,schema)->{
     if(path.equals("account"))return new JSONObject().put("membership",new JSONObject().put("active",active[0]));
     if(path.equals("devices/register")){registered[0]++;check(!body.has("accountPassword")&&!body.has("password"),"registration leaked password");JSONObject endpoint=new JSONObject().put("host","relay.invalid").put("port",22444);return new JSONObject().put("endpoint",endpoint).put("relay",new JSONObject(endpoint.toString()).put("credential","fixture"));}
     if(path.equals("vault")){if(body==null)return new JSONObject().put("revision",revision[0]).put("envelope",remote[0]);check(body.getLong("baseRevision")==revision[0],"incorrect optimistic revision");remote[0]=body.getJSONObject("envelope");writes[0]++;return new JSONObject().put("revision",++revision[0]);}
     throw new AssertionError("unexpected request");
   });ref[0]=cloud;
   JSONObject bundle=new JSONObject().put("format",1).put("store",new JSONObject().put("profiles",new JSONArray()).put("groups",new JSONArray()).put("preferences",new JSONObject()).put("secrets",new JSONObject()).put("accountPreferences",new JSONObject().put("autoDiscoverDevices",false))).put("ai",new JSONObject().put("providers",new JSONArray())).put("devices",new JSONArray()).put("unknown",new JSONObject().put("preserve",true));
   String key=android.util.Base64.encodeToString(new byte[32],android.util.Base64.URL_SAFE|android.util.Base64.NO_WRAP|android.util.Base64.NO_PADDING);
   JSONObject state=new JSONObject().put("session",new JSONObject().put("accountId",UUID.randomUUID().toString()).put("email","fixture@example.invalid")).put("key",key).put("bundle",bundle).put("revision",7);
   set(cloud,"state",state);remote[0]=(JSONObject)call(cloud,"encrypt",new Class<?>[]{JSONObject.class},bundle);
   AndroidHostProtocolTest.Capture capture=new AndroidHostProtocolTest.Capture();AndroidAgentHost host=new AndroidAgentHost(context,capture);int port;try(java.net.ServerSocket reserve=new java.net.ServerSocket(0)){port=reserve.getLocalPort();}
   try{
     host.start(port,"fixture-lan-password");JSONObject descriptor=host.connectionInfo("127.0.0.1",port);descriptor.remove("host");descriptor.remove("port");
     cloud.enrollHost(descriptor,host);check(writes[0]==1,"enrollment not persisted");check(CloudSync.writeSchema(state.getJSONObject("bundle"))==4,"account preference schema not retained");
     JSONObject device=state.getJSONObject("bundle").getJSONArray("devices").getJSONObject(0);check(!device.getString("accountPassword").equals("fixture-lan-password"),"LAN password uploaded");String saved=device.getString("accountPassword");
     cloud.enrollHost(descriptor,host);check(writes[0]==1,"unchanged enrollment rewrote vault");
     JSONObject latest=state.getJSONObject("bundle");latest.getJSONObject("store").getJSONArray("profiles").getJSONObject(0).put("name","user-name").put("group","user-group");remote[0]=(JSONObject)call(cloud,"encrypt",new Class<?>[]{JSONObject.class},latest);revision[0]++;
     cloud.enrollHost(descriptor,host);JSONObject kept=state.getJSONObject("bundle");check(kept.getJSONObject("store").getJSONArray("profiles").getJSONObject(0).getString("group").equals("user-group"),"user group overwritten");check(kept.getJSONObject("unknown").getBoolean("preserve"),"unknown fields lost");check(kept.getJSONArray("devices").getJSONObject(0).getString("accountPassword").equals(saved),"account password not stable");
     state.put("pending",new JSONObject());int before=registered[0];boolean denied=false;try{cloud.enrollHost(descriptor,host);}catch(Exception expected){denied=true;}check(denied&&registered[0]==before,"pending edits bypassed");state.remove("pending");active[0]=false;check(cloud.enrollHost(descriptor,host)==null&&registered[0]==before,"nonmember registered relay");
     return "OK: encrypted host enrollment preserves latest cloud fields/groups, stable separate secret, optimistic revision, pending and membership gates\n";
   }finally{host.close();capture.close();}
 }

}
