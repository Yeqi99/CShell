package org.canpshell.mobile;

import android.content.ContentResolver;
import android.net.Uri;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.function.BooleanSupplier;

/** Files stay on the selected authenticated Agent; never fall back to this phone. */
final class AgentFiles {
  private static final int CHUNK=65536;
  interface Rpc {Object manage(String method,JSONObject params)throws Exception;}
  private static JSONObject call(Rpc agent,String method,JSONObject params)throws Exception {
    Object value=agent.manage(method,params);
    if(!(value instanceof JSONObject))throw new IOException("CAgent 文件响应无效");
    return (JSONObject)value;
  }
  private static void check(BooleanSupplier cancelled)throws IOException {
    if(cancelled.getAsBoolean())throw new IOException("文件传输已停止");
  }
  static JSONObject location(String path)throws Exception {
    if(!path.startsWith("/")||path.length()>4096||path.indexOf('\\')>=0||path.indexOf(0)>=0)throw new IOException("CAgent 文件路径无效");
    String[] parts=path.substring(1).split("/",2);UUID.fromString(parts[0]);
    String relative=parts.length==1?"/":"/"+parts[1];
    for(String part:relative.split("/"))if(part.equals(".")||part.equals("..")||part.indexOf(':')>=0)throw new IOException("CAgent 文件路径无效");
    return new JSONObject().put("root",parts[0]).put("path",relative);
  }
  static JSONObject operation(ContentResolver resolver,AgentConnection agent,JSONObject request,Uri uri,BooleanSupplier cancelled)throws Exception {
    return operationWithRpc(resolver,agent::manage,request,uri,cancelled);
  }
  static JSONObject operationWithRpc(ContentResolver resolver,Rpc agent,JSONObject request,Uri uri,BooleanSupplier cancelled)throws Exception {
    check(cancelled);String op=request.getString("operation"),path=request.getString("path");
    if(op.equals("list")&&(path.equals(".")||path.equals("/"))){
      JSONArray roots=call(agent,"files.roots",new JSONObject()).getJSONArray("roots"),entries=new JSONArray();
      if(roots.length()>100)throw new IOException("CAgent 文件根目录响应无效");
      for(int i=0;i<roots.length();i++){JSONObject r=roots.getJSONObject(i);String id=r.getString("root");UUID.fromString(id);
        entries.put(new JSONObject().put("name",r.getString("label")).put("path","/"+id).put("directory",true).put("size",0));}
      return new JSONObject().put("path","/").put("parent","/").put("entries",entries);
    }
    JSONObject target=location(path);String root=target.getString("root"),relative=target.getString("path");
    if(op.equals("list")){
      JSONObject result=call(agent,"files.list",target);JSONArray entries=result.getJSONArray("entries");
      if(entries.length()>10000)throw new IOException("目录超过 10000 项，请打开更小的目录");
      for(int i=0;i<entries.length();i++){JSONObject e=entries.getJSONObject(i);String p="/"+root+e.getString("path");location(p);e.put("path",p);}
      String canonical="/"+root+result.getString("path");location(canonical);
      String parent=relative.equals("/")?"/":canonical.substring(0,canonical.lastIndexOf('/'));
      return result.put("path",canonical).put("parent",parent);
    }
    if(op.equals("preview")||op.equals("download")){
      boolean preview=op.equals("preview");ByteArrayOutputStream text=preview?new ByteArrayOutputStream():null;
      if(!preview&&uri==null)throw new IOException("请选择保存位置");
      try(OutputStream out=preview?text:resolver.openOutputStream(uri,"w")){
        if(out==null)throw new IOException("无法写入目标文件");
        long offset=0,size=-1;String version=null;
        for(;;){check(cancelled);JSONObject query=new JSONObject(target.toString()).put("offset",offset);if(version!=null)query.put("version",version);
          JSONObject part=call(agent,"files.read",query);long next=part.getLong("next"),declared=part.getLong("size");
          String receivedVersion=part.getString("version");byte[] bytes=Base64.decode(part.getString("data"),Base64.NO_WRAP);
          if(bytes.length>CHUNK||declared<0||next!=offset+bytes.length||next>declared||(!part.getBoolean("done")&&bytes.length==0)
            ||(size>=0&&size!=declared)||(version!=null&&!version.equals(receivedVersion)))throw new IOException("CAgent 文件传输响应不一致");
          if(preview&&declared>CHUNK)throw new IOException("文件超过 64 KiB，请下载后查看");
          out.write(bytes);offset=next;size=declared;version=receivedVersion;
          if(part.getBoolean("done")){if(offset!=size)throw new IOException("文件下载未完成");break;}
        }
      }
      if(!preview)return new JSONObject();
      byte[] bytes=text.toByteArray();for(byte b:bytes)if(b==0)throw new IOException("二进制文件，请下载后查看");
      return new JSONObject().put("name",path.substring(path.lastIndexOf('/')+1)).put("text",StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString());
    }
    if(op.equals("upload")){
      if(uri==null)throw new IOException("请选择上传文件");String name=null;long size=-1;
      try(Cursor c=resolver.query(uri,new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE},null,null,null)){
        if(c!=null&&c.moveToFirst()){name=c.getString(0);if(!c.isNull(1))size=c.getLong(1);}}
      if(name==null||name.isEmpty()||name.equals(".")||name.equals("..")||name.contains("/")||name.contains("\\")||name.indexOf(':')>=0||name.indexOf(0)>=0)throw new IOException("上传文件名无效");
      if(size<0)throw new IOException("文件提供方未返回大小，请先将文件保存到手机后上传");
      JSONObject destination=new JSONObject(target.toString()).put("path",relative+(relative.endsWith("/")?"":"/")+name).put("size",size);
      String id=call(agent,"files.uploadStart",destination).getString("id");UUID.fromString(id);boolean finished=false;
      try(InputStream in=resolver.openInputStream(uri)){
        if(in==null)throw new IOException("无法读取上传文件");byte[] buffer=new byte[CHUNK];long offset=0;int n;
        while((n=in.read(buffer))!=-1){check(cancelled);if(n==0)continue;if(offset+n>size)throw new IOException("源文件大小已改变");
          JSONObject result=call(agent,"files.uploadChunk",new JSONObject().put("id",id).put("offset",offset).put("data",Base64.encodeToString(buffer,0,n,Base64.NO_WRAP)));
          offset+=n;if(result.getLong("next")!=offset)throw new IOException("上传位置不一致");}
        if(offset!=size)throw new IOException("源文件大小已改变");check(cancelled);
        call(agent,"files.uploadFinish",new JSONObject().put("id",id));finished=true;return new JSONObject();
      }finally{if(!finished)try{call(agent,"files.uploadCancel",new JSONObject().put("id",id));}catch(Exception ignored){}}
    }
    throw new IOException("不支持的 CAgent 文件操作");
  }
}
