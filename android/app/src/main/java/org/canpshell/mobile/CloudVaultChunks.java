package org.canpshell.mobile;
import org.json.*;import java.io.*;import java.nio.charset.StandardCharsets;import java.security.MessageDigest;import java.util.*;
/** Bounded wire buffers; encrypted parts can resume after interruption. */
final class CloudVaultChunks {
 interface Request {JSONObject call(JSONObject body)throws Exception;}
 static final int CHUNK=1024*1024;
 static final class Unsupported extends IOException{}
 static String hash(String text)throws Exception{byte[] digest=MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte b:digest)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
 static JSONObject transfer(Request request,File cache,JSONObject body,int maxBytes)throws Exception{
  JSONObject manifest;
  try{manifest=request.call(null);}catch(CloudSync.HttpFailure error){if(error.status==404)throw new Unsupported();throw error;}
  if(manifest.optInt("transport")!=1||manifest.optInt("chunkSize")!=CHUNK)throw new IOException("同步分块协议不兼容");
  if(body!=null){JSONObject envelope=body.getJSONObject("envelope");String text=envelope.getString("ciphertext"),id=body.getString("mutationId");if(text.length()>((maxBytes+18L)/3)*4)throw new IOException("同步数据超过本设备安全内存容量");
   JSONObject state=request.call(new JSONObject().put("action","begin").put("baseRevision",body.getLong("baseRevision")).put("mutationId",id).put("nonce",envelope.getString("nonce")).put("length",text.length()).put("digest",hash(text)));
   if(state.optBoolean("committed"))return new JSONObject().put("revision",state.getLong("revision"));
   Set<Integer> received=new HashSet<>();JSONArray list=state.getJSONArray("received");if(list.length()>350)throw new IOException("分块状态错误");for(int i=0;i<list.length();i++)received.add(list.getInt(i));
   for(int part=0;part<(text.length()+CHUNK-1)/CHUNK;part++){if(received.contains(part))continue;String data=text.substring(part*CHUNK,Math.min(text.length(),(part+1)*CHUNK));request.call(new JSONObject().put("action","put").put("mutationId",id).put("part",part).put("data",data).put("digest",hash(data)));}
   return request.call(new JSONObject().put("action","commit").put("mutationId",id));
  }
  long revision=manifest.getLong("revision");if(revision==0&&manifest.isNull("envelope"))return new JSONObject().put("revision",0).put("envelope",JSONObject.NULL);
  int length=manifest.getInt("length");if(revision<1||length<24||length>((maxBytes+18L)/3)*4)throw new IOException("云端数据超过本设备安全内存容量；请使用更大内存设备，原数据保留");
  File directory=new File(cache,Long.toString(revision));if(!directory.mkdirs()&&!directory.isDirectory())throw new IOException("无法建立同步缓存");
  File[] previous=cache.listFiles();if(previous!=null)for(File old:previous)if(old.getName().matches("[0-9]+")&&!old.equals(directory)){File[] files=old.listFiles();if(files!=null)for(File f:files)if(f.getName().matches("[0-9]+\\.json"))f.delete();old.delete();}
  StringBuilder text=new StringBuilder(length);
  for(int part=0;part<(length+CHUNK-1)/CHUNK;part++){File file=new File(directory,part+".json");JSONObject value=null;
   if(file.length()>0&&file.length()<CHUNK+256)try(FileInputStream in=new FileInputStream(file)){ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>CHUNK+256)throw new IOException("cache size");out.write(buffer,0,n);}value=new JSONObject(out.toString("UTF-8"));}catch(Exception ignored){}
   if(!valid(value,Math.min(CHUNK,length-part*CHUNK))){value=request.call(new JSONObject().put("action","get").put("revision",revision).put("part",part));if(!valid(value,Math.min(CHUNK,length-part*CHUNK)))throw new IOException("分块摘要不一致");try(FileOutputStream out=new FileOutputStream(file)){out.write(value.toString().getBytes(StandardCharsets.UTF_8));}}
   text.append(value.getString("data"));
  }
  String ciphertext=text.toString();if(!manifest.isNull("digest")&&!hash(ciphertext).equals(manifest.getString("digest")))throw new IOException("同步密文摘要不一致");
  return new JSONObject().put("revision",revision).put("envelope",new JSONObject().put("format",1).put("nonce",manifest.getString("nonce")).put("ciphertext",ciphertext));
 }
 static boolean valid(JSONObject v,int size)throws Exception{return v!=null&&v.optString("data").length()==size&&hash(v.getString("data")).equals(v.optString("digest"));}
}
