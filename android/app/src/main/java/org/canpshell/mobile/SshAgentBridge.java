package org.canpshell.mobile;

import com.jcraft.jsch.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Management over the already verified SSH connection; no public Agent port or new credentials. */
final class SshAgentBridge implements AutoCloseable {
  private final ChannelExec channel;
  private final OutputStream output;
  private final Map<String,CompletableFuture<Object>> pending=new ConcurrentHashMap<>();
  private volatile boolean closed;
  private String identity;
  SshAgentBridge(Session session)throws Exception {
    channel=(ChannelExec)session.openChannel("exec");
    channel.setCommand("\"$HOME/.local/share/cagent/cshell/current/cagent\" bridge");
    channel.setErrStream(new OutputStream(){public void write(int b){}});
    InputStream input=channel.getInputStream();output=channel.getOutputStream();
    try{channel.connect(10000);}catch(Exception e){channel.disconnect();throw e;}
    Thread reader=new Thread(()->{
      try(InputStreamReader in=new InputStreamReader(input,StandardCharsets.UTF_8)){
        StringBuilder line=new StringBuilder();char[] chunk=new char[4096];int n;
        while((n=in.read(chunk))!=-1){for(int i=0;i<n;i++){
          if(chunk[i]=='\n'){
            JSONObject reply=new JSONObject(line.toString());line.setLength(0);
            CompletableFuture<Object> p=pending.remove(reply.optString("id"));
            if(p!=null){if(reply.has("error"))p.completeExceptionally(new IOException(reply.getString("error")));else p.complete(reply.opt("result"));}
          }else{line.append(chunk[i]);if(line.length()>3*1024*1024)throw new IOException("cagent 响应过大");}
        }}
      }catch(Exception ignored){}finally{close();}
    },"cshell-ssh-cagent");reader.setDaemon(true);reader.start();
    try{JSONObject status=(JSONObject)manage("client.status",new JSONObject());identity=status.getString("deviceId");UUID.fromString(identity);}
    catch(Exception e){close();throw e;}
  }
  String browserIdentity(){return identity;}
  Object manage(String method,Object params)throws Exception {
    String id=UUID.randomUUID().toString();CompletableFuture<Object> result=new CompletableFuture<>();
    synchronized(output){
      if(closed||pending.size()>=8)throw new IOException("cagent 通道已断开或繁忙");
      pending.put(id,result);
      try{output.write((new JSONObject().put("id",id).put("call",new JSONObject().put("method",method).put("params",params==null?new JSONObject():params)).toString()+"\n").getBytes(StandardCharsets.UTF_8));output.flush();}
      catch(Exception e){pending.remove(id);throw e;}
    }
    try{return result.get(60,TimeUnit.SECONDS);}catch(ExecutionException e){throw new IOException(e.getCause().getMessage());}finally{pending.remove(id);}
  }
  public void close(){closed=true;channel.disconnect();for(CompletableFuture<Object> p:pending.values())p.completeExceptionally(new IOException("cagent 通道已断开"));pending.clear();}
}
