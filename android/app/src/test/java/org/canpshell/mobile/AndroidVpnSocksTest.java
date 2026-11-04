package org.canpshell.mobile;
import java.io.*;import java.net.*;import java.nio.charset.StandardCharsets;import java.util.concurrent.*;import java.util.concurrent.atomic.*;
public final class AndroidVpnSocksTest {
 static void require(boolean v){if(!v)throw new AssertionError();}
 static Socket connect(AndroidVpnSocks socks)throws Exception{Socket s=new Socket("127.0.0.1",socks.port());s.setSoTimeout(3000);s.getOutputStream().write(new byte[]{5,1,0});require(AndroidVpnSocks.read(s.getInputStream(),2)[1]==0);return s;}
 static void request(Socket s,String host)throws Exception{byte[] name=host.getBytes(StandardCharsets.US_ASCII);s.getOutputStream().write(new byte[]{5,1,0,3,(byte)name.length});s.getOutputStream().write(name);s.getOutputStream().write(new byte[]{1,(byte)187});}
 public static void main(String[] args)throws Exception{
  ExecutorService worker=Executors.newSingleThreadExecutor();AtomicInteger calls=new AtomicInteger();
  try(ServerSocket exit=new ServerSocket(0,4,InetAddress.getLoopbackAddress());AndroidVpnSocks socks=new AndroidVpnSocks(()->{calls.incrementAndGet();return exit.getLocalPort();})){
   Future<String> echo=worker.submit(()->{try(Socket s=exit.accept()){s.setSoTimeout(3000);StringBuilder h=new StringBuilder();while(!h.toString().endsWith("\r\n\r\n"))h.append((char)s.getInputStream().read());s.getOutputStream().write("HTTP/1.1 200 OK\r\n\r\n".getBytes());byte[] bytes=AndroidVpnSocks.read(s.getInputStream(),4);s.getOutputStream().write(bytes);return h.toString();}});
   try(Socket s=connect(socks)){request(s,"does-not-resolve.invalid");require(AndroidVpnSocks.read(s.getInputStream(),10)[1]==0);s.getOutputStream().write("test".getBytes());require(new String(AndroidVpnSocks.read(s.getInputStream(),4)).equals("test"));}
   require(echo.get(4,TimeUnit.SECONDS).startsWith("CONNECT does-not-resolve.invalid:443 HTTP/1.1"));require(calls.get()==1);
   try(Socket s=connect(socks)){s.getOutputStream().write(new byte[]{5,3,0,1});require(AndroidVpnSocks.read(s.getInputStream(),10)[1]==7);}require(calls.get()==1);
   try(Socket s=connect(socks)){request(s,"bad\r\nhost");require(AndroidVpnSocks.read(s.getInputStream(),10)[1]!=0);}require(calls.get()==1);
  }finally{worker.shutdownNow();}
  try(AndroidVpnSocks socks=new AndroidVpnSocks(()->{throw new IOException("lease expired");});Socket s=connect(socks)){request(s,"example.com");require(AndroidVpnSocks.read(s.getInputStream(),10)[1]!=0);}
  System.out.println("VPN SOCKS: TCP roundtrip, remote DNS, UDP rejection, injection rejection, expired-exit fail-closed passed");
 }
}
