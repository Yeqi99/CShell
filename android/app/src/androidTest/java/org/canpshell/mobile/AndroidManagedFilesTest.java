package org.canpshell.mobile;
import android.content.Context;
import org.json.*;
import java.io.*;
import java.util.*;

final class AndroidManagedFilesTest {
 static void run(Context context)throws Exception{
  AndroidManagedFiles files=new AndroidManagedFiles(context);String root=((JSONObject)files.call("files.roots",new JSONObject(),"one")).getJSONArray("roots").getJSONObject(0).getString("root");String dir="/fixture-"+UUID.randomUUID(),p=dir+"/test.txt";
  try{
   files.call("files.action",new JSONObject().put("root",root).put("path",dir).put("action","mkdir"),"one");
   JSONObject start=(JSONObject)files.call("files.uploadStart",new JSONObject().put("root",root).put("path",p).put("size",3),"one");String id=start.getString("id");
   File staging=new File(context.getCacheDir(),"remote-uploads");File orphan=new File(staging,"upload-orphan.part");try(FileOutputStream out=new FileOutputStream(orphan)){out.write(1);}int activeCount=staging.listFiles().length;
   AndroidManagedFiles other=new AndroidManagedFiles(context);check(!orphan.exists()&&staging.listFiles().length==activeCount-1,"Restart cleanup removed live upload or retained orphan");other.close();
   boolean denied=false;try{files.call("files.uploadChunk",new JSONObject().put("id",id).put("offset",0).put("data","YWJj"),"two");}catch(IOException e){denied=true;}check(denied,"Cross-owner upload accepted");
   files.call("files.uploadChunk",new JSONObject().put("id",id).put("offset",0).put("data","YWJj"),"one");files.call("files.uploadFinish",new JSONObject().put("id",id),"one");
   JSONObject read=(JSONObject)files.call("files.read",new JSONObject().put("root",root).put("path",p).put("offset",0),"one");check(read.getString("data").equals("YWJj")&&read.getBoolean("done"),"File roundtrip failed");
   denied=false;try{files.call("files.uploadStart",new JSONObject().put("root",root).put("path",p).put("size",0),"one");}catch(IOException e){denied=true;}check(denied,"Upload overwrote existing file");
   denied=false;try{files.call("files.list",new JSONObject().put("root",root).put("path","/../"),"one");}catch(IOException e){denied=true;}check(denied,"Traversal accepted");
   denied=false;try{files.call("files.list",new JSONObject().put("root",root).put("path","/../../shared_prefs"),"one");}catch(IOException e){denied=true;}check(denied,"Private settings exposed");
   files.call("files.action",new JSONObject().put("root",root).put("path",p).put("action","rename").put("destination",dir+"/renamed.txt"),"one");p=dir+"/renamed.txt";
   check(((JSONObject)files.call("files.list",new JSONObject().put("root",root).put("path",dir),"one")).getJSONArray("entries").length()==1,"File list mismatch");
   denied=false;try{files.call("files.read",new JSONObject().put("root",root).put("path",p).put("offset",0).put("version","stale"),"one");}catch(IOException e){denied=true;}check(denied,"Stale download version accepted");
   denied=false;try{files.call("files.uploadStart",new JSONObject().put("root",root).put("path",dir+"/large").put("size",512L*1024*1024+1),"one");}catch(IOException e){denied=true;}check(denied,"Oversized upload accepted");
   String expired=((JSONObject)files.call("files.uploadStart",new JSONObject().put("root",root).put("path",dir+"/expired").put("size",1),"one")).getString("id");
   java.lang.reflect.Field field=AndroidManagedFiles.class.getDeclaredField("uploads");field.setAccessible(true);Map<?,?> map=(Map<?,?>)field.get(files);Object upload=map.get(expired);java.lang.reflect.Field expiry=upload.getClass().getDeclaredField("expires");expiry.setAccessible(true);expiry.setLong(upload,0);
   denied=false;try{files.call("files.uploadChunk",new JSONObject().put("id",expired).put("offset",0).put("data","YQ=="),"one");}catch(IOException e){denied=true;}check(denied&&!map.containsKey(expired),"Expired upload remained usable");
   AndroidApplications apps=new AndroidApplications(context);JSONArray rows=apps.list();for(int i=0;i<rows.length();i++)check(!rows.getJSONObject(i).getString("id").isEmpty(),"Invalid launcher metadata");
   denied=false;try{apps.launch(new JSONObject().put("packageName","not.installed.cagent.fixture"));}catch(IOException e){denied=true;}check(denied,"Unlisted application launched");
  }finally{try{files.call("files.action",new JSONObject().put("root",root).put("path",p).put("action","delete"),"one");files.call("files.action",new JSONObject().put("root",root).put("path",dir).put("action","delete"),"one");}finally{files.close();}}
 }
 private static void check(boolean ok,String reason){if(!ok)throw new AssertionError(reason);}
}
