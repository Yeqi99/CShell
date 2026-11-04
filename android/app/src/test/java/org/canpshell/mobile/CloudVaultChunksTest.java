package org.canpshell.mobile;
import org.json.*;import java.io.*;import java.nio.file.*;import java.util.*;
public final class CloudVaultChunksTest {
 public static void main(String[] args)throws Exception{
  File cache=Files.createTempDirectory("android-chunks-").toFile();String data="A".repeat(3*CloudVaultChunks.CHUNK);Map<Integer,Integer> gets=new HashMap<>();boolean[] interrupt={true};
  CloudVaultChunks.Request request=body->{if(body==null)return new JSONObject().put("transport",1).put("chunkSize",CloudVaultChunks.CHUNK).put("revision",1).put("length",data.length()).put("nonce","eHh4eHh4eHh4eHh4").put("digest",CloudVaultChunks.hash(data));int part=body.getInt("part");gets.put(part,gets.getOrDefault(part,0)+1);if(part==1&&interrupt[0]){interrupt[0]=false;throw new IOException("offline");}String chunk=data.substring(part*CloudVaultChunks.CHUNK,(part+1)*CloudVaultChunks.CHUNK);return new JSONObject().put("data",chunk).put("digest",CloudVaultChunks.hash(chunk));};
  try{
   try{CloudVaultChunks.transfer(request,cache,null,4*1024*1024);throw new AssertionError("expected interruption");}catch(IOException expected){}
   JSONObject result=CloudVaultChunks.transfer(request,cache,null,4*1024*1024);if(!result.getJSONObject("envelope").getString("ciphertext").equals(data)||gets.get(0)!=1)throw new AssertionError("resume failed");
   try{CloudVaultChunks.transfer(request,cache,null,1);throw new AssertionError("expected capacity rejection");}catch(IOException expected){}
   Map<Integer,String> stored=new HashMap<>();boolean[] lost={true};int[] putCount={0};
   CloudVaultChunks.Request upload=body->{if(body==null)return new JSONObject().put("transport",1).put("chunkSize",CloudVaultChunks.CHUNK);String action=body.getString("action");if(action.equals("begin")){JSONArray received=new JSONArray();for(int p:stored.keySet())received.put(p);return new JSONObject().put("received",received);}if(action.equals("put")){putCount[0]++;int p=body.getInt("part");stored.put(p,body.getString("data"));if(p==1&&lost[0]){lost[0]=false;throw new IOException("lost response");}return new JSONObject().put("ok",true);}return new JSONObject().put("revision",2);};
   JSONObject pending=new JSONObject().put("baseRevision",1).put("mutationId",UUID.randomUUID().toString()).put("envelope",result.getJSONObject("envelope"));
   try{CloudVaultChunks.transfer(upload,cache,pending,4*1024*1024);throw new AssertionError("expected lost response");}catch(IOException expected){}
   if(CloudVaultChunks.transfer(upload,cache,pending,4*1024*1024).getInt("revision")!=2||putCount[0]!=3)throw new AssertionError("upload did not resume");
   System.out.println("PASS Android chunk resume and preallocation capacity rejection under -Xmx64m");
  }finally{File[] dirs=cache.listFiles();if(dirs!=null)for(File dir:dirs){File[] files=dir.listFiles();if(files!=null)for(File f:files)f.delete();dir.delete();}cache.delete();}
 }
}
