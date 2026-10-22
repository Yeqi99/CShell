package org.canpshell.mobile;

import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONObject;
import android.util.Base64;

/** Loopback SOCKS endpoint. Target DNS and sockets belong exclusively to the selected agent. */
final class MachineBrowserProxy implements AutoCloseable {
  interface Rpc {Object manage(String method,Object params)throws Exception;}
  private final Rpc agent;
  private com.jcraft.jsch.Session ssh;
  private final ServerSocket server;
  private final Set<Socket> clients=ConcurrentHashMap.newKeySet();
  private final ExecutorService pool=Executors.newFixedThreadPool(26);
  private volatile boolean closed;
  MachineBrowserProxy(AgentConnection agent)throws Exception{this(agent::manage);}
  MachineBrowserProxy(com.jcraft.jsch.Session ssh)throws Exception{this((Rpc)null);this.ssh=ssh;}
  MachineBrowserProxy(Rpc agent)throws Exception{
    this.agent=agent;if(agent!=null)agent.manage("browser.status",new JSONObject());
    server=new ServerSocket();server.bind(new InetSocketAddress("127.0.0.1",0),12);
    pool.execute(()->{while(!closed)try{Socket s=server.accept();if(clients.size()>=12){s.close();continue;}clients.add(s);pool.execute(()->serve(s));}catch(IOException e){if(!closed)close();}});
  }
  int port(){return server.getLocalPort();}
  private void serve(Socket s){String id=null;
    try{ s.setSoTimeout(15000);DataInputStream in=new DataInputStream(s.getInputStream());OutputStream out=s.getOutputStream();
      if(in.readUnsignedByte()!=5)throw new IOException();int count=in.readUnsignedByte();boolean anonymous=false;for(int i=0;i<count;i++)if(in.readUnsignedByte()==0)anonymous=true;
      out.write(new byte[]{5,(byte)(anonymous?0:255)});out.flush();if(!anonymous)throw new IOException();
      if(in.readUnsignedByte()!=5||in.readUnsignedByte()!=1||in.readUnsignedByte()!=0)throw new IOException();
      int type=in.readUnsignedByte();String host;
      if(type==3){int n=in.readUnsignedByte();byte[] bytes=new byte[n];in.readFully(bytes);host=new String(bytes,StandardCharsets.US_ASCII);}
      else if(type==1||type==4){byte[] bytes=new byte[type==1?4:16];in.readFully(bytes);host=InetAddress.getByAddress(bytes).getHostAddress();}
      else throw new IOException();
      int port=in.readUnsignedShort();if(port==0||closed)throw new IOException();
      if(agent==null){serveSsh(s,in,out,host,port);return;}
      id=((JSONObject)agent.manage("browser.open",new JSONObject().put("host",host).put("port",port))).getString("id");
      final String channel=id;out.write(new byte[]{5,0,0,1,0,0,0,0,0,0});out.flush();s.setSoTimeout(60000);
      pool.execute(()->{try{while(!closed&&!s.isClosed()){JSONObject v=(JSONObject)agent.manage("browser.read",new JSONObject().put("id",channel));byte[] b=Base64.decode(v.getString("data"),Base64.DEFAULT);out.write(b);out.flush();if(v.optBoolean("ended")||v.has("error"))break;}}catch(Exception ignored){}finally{try{s.close();}catch(Exception ignored){}}});
      byte[] bytes=new byte[32768];int n;long sequence=0;
      while(!closed&&(n=in.read(bytes))!=-1)agent.manage("browser.write",new JSONObject().put("id",id).put("sequence",sequence++).put("data",Base64.encodeToString(bytes,0,n,Base64.NO_WRAP)));
    }catch(Exception ignored){}finally{clients.remove(s);try{s.close();}catch(Exception ignored){}if(id!=null)try{agent.manage("browser.close",new JSONObject().put("id",id));}catch(Exception ignored){}}
  }
  private void serveSsh(Socket socket,InputStream input,OutputStream output,String host,int port)throws Exception {
    if(ssh==null||!ssh.isConnected()||closed)throw new IOException("SSH 已断开");
    com.jcraft.jsch.ChannelDirectTCPIP channel=(com.jcraft.jsch.ChannelDirectTCPIP)ssh.openChannel("direct-tcpip");
    try {
      channel.setHost(host);channel.setPort(port);channel.setOrgIPAddress("127.0.0.1");channel.setOrgPort(socket.getPort());
      InputStream remote=channel.getInputStream();OutputStream send=channel.getOutputStream();channel.connect(15000);
      output.write(new byte[]{5,0,0,1,0,0,0,0,0,0});output.flush();socket.setSoTimeout(60000);
      pool.execute(()->{try{byte[] b=new byte[32768];int n;while(!closed&&(n=remote.read(b))!=-1){output.write(b,0,n);output.flush();}}catch(Exception ignored){}finally{try{socket.close();}catch(Exception ignored){}channel.disconnect();}});
      byte[] b=new byte[32768];int n;while(!closed&&(n=input.read(b))!=-1){send.write(b,0,n);send.flush();}
    }finally{channel.disconnect();}
  }
  public void close(){closed=true;try{server.close();}catch(Exception ignored){}for(Socket s:clients)try{s.close();}catch(Exception ignored){}clients.clear();pool.shutdownNow();}
}
