package org.canpshell.mobile;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

/** Bounded preview and streaming copies shared by the SAF implementation. */
final class LocalFileStreams {
  interface Check { void run() throws IOException; }
  static String preview(InputStream in, Check check)throws IOException {
    if(in==null)throw new IOException("无法读取文件");
    ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] bytes=new byte[4096];int n;
    while((n=in.read(bytes))!=-1){check.run();if(out.size()+n>65536)throw new IOException("文件超过预览限制");out.write(bytes,0,n);}
    check.run();byte[] content=out.toByteArray();for(byte b:content)if(b==0)throw new IOException("二进制文件，请导出后查看");
    return StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(content)).toString();
  }
  static void copy(InputStream in,OutputStream out,Check check)throws IOException {
    if(in==null||out==null)throw new IOException("无法打开所选文件");byte[] bytes=new byte[65536];int n;
    while((n=in.read(bytes))!=-1){check.run();out.write(bytes,0,n);}check.run();out.flush();
  }
}
