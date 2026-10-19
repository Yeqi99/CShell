package org.canpshell.mobile;

import org.json.*;
import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import android.util.Base64;

/** Desktop v1 over the existing pinned mutual-TLS management channel.
 * Keys never enter the WebView. TCP reassembly is bounded to one frame. */
final class DesktopTransport {
  private final JSONObject ticket;
  private final AgentConnection.Events events;
  private final byte[] session,sendKey,receiveKey,mediaKey,bootstrap;
  private DataOutputStream out;
  private long tx,rx,mediaSequence=-1,inputSequence;
  private volatile boolean ready,video;
  private long frameId=-1,timestamp;
  private int nextPart,partCount;
  private boolean key;
  private volatile double rtt;private long sampleAt=System.nanoTime(),sampleBytes;
  private long outstandingFrame=-1;
  private ByteArrayOutputStream frame=new ByteArrayOutputStream();
  DesktopTransport(JSONObject t,AgentConnection.Events e)throws Exception {
    ticket=t;events=e;JSONObject k=t.getJSONObject("keys");session=hex(t.getString("session"));sendKey=hex(k.getString("viewerControl"));receiveKey=hex(k.getString("hostControl"));mediaKey=hex(k.getString("hostMedia"));bootstrap=hex(k.getString("bootstrap"));
    if(session.length!=8||sendKey.length!=32||receiveKey.length!=32||mediaKey.length!=32||bootstrap.length!=32)throw new IOException("Invalid desktop keys");
  }
  static byte[] hex(String s)throws IOException {if(!s.matches("(?:[a-fA-F0-9]{2})+"))throw new IOException("Invalid hex");byte[] b=new byte[s.length()/2];for(int i=0;i<b.length;i++)b[i]=(byte)Integer.parseInt(s.substring(i*2,i*2+2),16);return b;}
  private byte[] proof(String s)throws Exception {Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(bootstrap,"HmacSHA256"));return mac.doFinal(s.getBytes(StandardCharsets.UTF_8));}
  private static String hexString(byte[] b){StringBuilder s=new StringBuilder();for(byte v:b)s.append(String.format(Locale.ROOT,"%02x",v));return s.toString();}
  private static JSONObject line(InputStream in)throws Exception {ByteArrayOutputStream b=new ByteArrayOutputStream();int v;while((v=in.read())!=-1&&v!=10){if(b.size()>=8192)throw new IOException("Desktop bootstrap too large");b.write(v);}if(v<0)throw new EOFException();return new JSONObject(b.toString("UTF-8"));}
  private byte[] crypt(boolean encrypt,byte[] key,byte[] sequence,byte[] aad,byte[] body)throws Exception {byte[] nonce=new byte[12];System.arraycopy(sequence,0,nonce,4,8);Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(encrypt?Cipher.ENCRYPT_MODE:Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,nonce));c.updateAAD(aad);return c.doFinal(body);}
  private synchronized void send(JSONObject value)throws Exception {
    if(out==null)return;byte[] body=value.toString().getBytes(StandardCharsets.UTF_8);if(body.length>8192||tx==Long.MAX_VALUE)throw new IOException("Desktop control budget");
    byte[] sequence=ByteBuffer.allocate(8).putLong(tx++).array(),aad=ByteBuffer.allocate(16).put(session).put(sequence).array();byte[] encrypted=crypt(true,sendKey,sequence,aad,body);out.writeInt(8+encrypted.length);out.write(sequence);out.write(encrypted);out.flush();
  }
  synchronized void command(JSONObject value)throws Exception {
    if(!ready)return;String op=value.getString("op");
    if(!Arrays.asList("input","release-input","ack","keyframe","quality","feedback").contains(op))throw new IOException("Invalid desktop command");
    if(op.equals("input")){if(!ticket.getBoolean("control")||!video)return;value.getJSONObject("value").put("generation",1).put("sequence",++inputSequence);}
    if(op.equals("ack")){if(!String.valueOf(outstandingFrame).equals(value.getString("id")))return;outstandingFrame=-1;}
    if(op.equals("feedback")){long now=System.nanoTime();double elapsed=(now-sampleAt)/1e9;value.getJSONObject("value").put("rttMs",rtt).put("jitterMs",0).put("loss",0).put("deliveredBitsPerSecond",sampleBytes*8/Math.max(.001,elapsed));sampleAt=now;sampleBytes=0;}
    send(value);
  }
  void run(InputStream input,OutputStream output)throws Exception {
    ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor();
    try {
      JSONObject hello=line(input);String nonce=hello.getString("nonce"),id=ticket.getString("id");if(hello.getInt("version")!=1||!nonce.matches("[a-f0-9]{64}"))throw new IOException("Desktop bootstrap invalid");
      output.write((new JSONObject().put("id",id).put("proof",hexString(proof("client:"+nonce+":"+id))).toString()+"\n").getBytes(StandardCharsets.UTF_8));output.flush();
      if(!MessageDigest.isEqual(proof("server:"+nonce+":"+id),hex(line(input).getString("proof"))))throw new IOException("Desktop host authentication failed");
      out=new DataOutputStream(output);
      send(new JSONObject().put("op","hello").put("identity",ticket.getString("owner")).put("generation",ticket.getString("generation")).put("port",0).put("transport","tcp"));
      timer.scheduleAtFixedRate(()->{try{if(ready){send(new JSONObject().put("op","ping").put("sent",System.nanoTime()/1e6));if(video&&ticket.optBoolean("control"))command(new JSONObject().put("op","input").put("value",new JSONObject().put("kind","lease")));}}catch(Exception e){try{input.close();}catch(Exception ignored){}}},2,2,TimeUnit.SECONDS);
      DataInputStream in=new DataInputStream(input);
      while(true){int encoded=in.readInt(),length=encoded&0x7fffffff;boolean media=encoded<0;if(length<25||length>(media?16384:8216))throw new IOException("Desktop record length");byte[] p=new byte[length];in.readFully(p);
        if(media){if(!ready)throw new IOException("Desktop handshake required");media(p);continue;}
        byte[] sequence=Arrays.copyOf(p,8);if(ByteBuffer.wrap(sequence).getLong()!=rx)throw new IOException("Desktop control replay");
        JSONObject m=new JSONObject(new String(crypt(false,receiveKey,sequence,ByteBuffer.allocate(16).put(session).put(sequence).array(),Arrays.copyOfRange(p,8,p.length)),StandardCharsets.UTF_8));rx++;
        String op=m.getString("op");if(op.equals("hello")){if(ready||!ticket.getString("hostIdentity").equals(m.getString("identity"))||!ticket.getString("generation").equals(m.getString("generation"))||!"tcp".equals(m.getString("transport"))||m.getInt("port")!=0)throw new IOException("Desktop identity mismatch");ready=true;events.emit("desktop-ready","");}
        else if(!ready)throw new IOException("Desktop handshake required");
        else if(op.equals("video")){video=true;events.emit("desktop-video",m.getJSONObject("value").toString());}
        else if(op.equals("notice"))events.emit("desktop-notice",m.getString("value"));
        else if(op.equals("ping"))send(new JSONObject().put("op","pong").put("sent",m.opt("sent")));
        else if(op.equals("pong")){if(m.has("sent"))rtt=Math.max(0,System.nanoTime()/1e6-m.getDouble("sent"));}
        else if(op.equals("close"))throw new IOException(m.optString("reason","Desktop closed"));
        else if(!op.equals("pong"))throw new IOException("Unsupported desktop control");
      }
    } finally {ready=false;video=false;timer.shutdownNow();frame.reset();events.emit("desktop-closed","");}
  }
  private void media(byte[] p)throws Exception {
    if(p.length<=48||p[0]!=1||(p[1]!=0&&p[1]!=1)||!Arrays.equals(session,Arrays.copyOfRange(p,2,10)))throw new IOException("Invalid desktop media");
    ByteBuffer h=ByteBuffer.wrap(p);long seq=h.getLong(10);if(seq!=mediaSequence+1)throw new IOException("Desktop media replay or gap");
    byte[] data=crypt(false,mediaKey,Arrays.copyOfRange(p,10,18),Arrays.copyOf(p,32),Arrays.copyOfRange(p,32,p.length));mediaSequence=seq;
    long id=Integer.toUnsignedLong(h.getInt(18)),time=0;for(int i=26;i<32;i++)time=(time<<8)|(p[i]&255);int index=Short.toUnsignedInt(h.getShort(22)),count=Short.toUnsignedInt(h.getShort(24));
    if(index==0){if(id<=frameId||nextPart!=partCount)throw new IOException("Invalid frame ordering");frameId=id;timestamp=time;partCount=count;nextPart=0;key=p[1]==1;frame.reset();}
    if(count==0||id!=frameId||index!=nextPart||count!=partCount||time!=timestamp||key!=(p[1]==1)||frame.size()+data.length>32*1024*1024)throw new IOException("Desktop frame budget or ordering");
    synchronized(this){sampleBytes+=data.length;}frame.write(data);nextPart++;
    if(nextPart==partCount){synchronized(this){if(outstandingFrame>=0)throw new IOException("Desktop renderer backpressure");outstandingFrame=frameId;}events.emit("desktop-frame",new JSONObject().put("id",String.valueOf(frameId)).put("timestamp",timestamp).put("key",key).put("data",Base64.encodeToString(frame.toByteArray(),Base64.NO_WRAP)).toString());frame.reset();}
  }
}
