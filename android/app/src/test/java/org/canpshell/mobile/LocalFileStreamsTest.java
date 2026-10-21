package org.canpshell.mobile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
public final class LocalFileStreamsTest {
  interface Action {void run() throws Exception;}
  static void rejects(Action action)throws Exception {try{action.run();}catch(IOException expected){return;}throw new AssertionError("Expected bounded/cancelled failure");}
  public static void main(String[] args)throws Exception {
    String text="手机文件 UTF-8 内容";if(!text.equals(LocalFileStreams.preview(new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)),()->{})))throw new AssertionError("Unicode preview");
    rejects(()->LocalFileStreams.preview(new ByteArrayInputStream(new byte[65537]),()->{}));
    rejects(()->LocalFileStreams.preview(new ByteArrayInputStream(new byte[]{65,0,66}),()->{}));
    rejects(()->LocalFileStreams.preview(new ByteArrayInputStream(new byte[]{(byte)0xc3}),()->{}));
    byte[] data=new byte[200000];Arrays.fill(data,(byte)7);ByteArrayOutputStream out=new ByteArrayOutputStream();LocalFileStreams.copy(new ByteArrayInputStream(data),out,()->{});if(!Arrays.equals(data,out.toByteArray()))throw new AssertionError("Copy changed bytes");
    ByteArrayOutputStream stopped=new ByteArrayOutputStream();int[] checks={0};rejects(()->LocalFileStreams.copy(new ByteArrayInputStream(data),stopped,()->{if(++checks[0]==2)throw new IOException("revoked");}));if(stopped.size()!=65536)throw new AssertionError("Revocation did not stop before next write");
    System.out.println("PASS local file UTF-8 preview, 64 KiB bound, binary/invalid encoding rejection, streaming copy and mid-copy revocation");
  }
}
