package org.canpshell.mobile;
import java.io.*;import java.net.*;import java.util.*;import java.util.concurrent.*;import org.json.*;
/** Bounded duplex bytes; protocol ownership and authentication are checked by the caller. */
final class AndroidNetworkChannel implements AutoCloseable {
 private static final ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"cagent-network-deadlines");t.setDaemon(true);return t;});
 final Socket socket;final ArrayBlockingQueue<byte[]> incoming=new ArrayBlockingQueue<>(4);volatile boolean ended,announced;long sequence;final Thread reader;
 AndroidNetworkChannel(Socket socket)throws IOException{this.socket=socket;reader=new Thread(()->{try{InputStream in=socket.getInputStream();byte[] buffer=new byte[65536];int n;while(!socket.isClosed()&&(n=in.read(buffer))!=-1)incoming.put(Arrays.copyOf(buffer,n));}catch(Exception ignored){}finally{ended=true;}},"cagent-network-reader");reader.setDaemon(true);reader.start();}
 JSONObject read()throws Exception{byte[] bytes=incoming.poll(40,TimeUnit.MILLISECONDS);if(bytes==null)bytes=new byte[0];return new JSONObject().put("data",Base64.getEncoder().encodeToString(bytes)).put("ended",ended&&incoming.isEmpty());}
 synchronized JSONObject write(String encoded,Long seq)throws Exception{if(encoded.length()>87384)throw new IOException("Network chunk too large");byte[] bytes=Base64.getDecoder().decode(encoded);if(bytes.length>65536||!Base64.getEncoder().encodeToString(bytes).equals(encoded))throw new IOException("Invalid network chunk");if(seq!=null&&seq!=sequence)throw new IOException("Network sequence mismatch");ScheduledFuture<?> deadline=deadlines.schedule(()->{try{socket.close();}catch(IOException ignored){}},5,TimeUnit.SECONDS);try{socket.getOutputStream().write(bytes);socket.getOutputStream().flush();}finally{deadline.cancel(false);}if(seq!=null)sequence++;return new JSONObject().put("written",bytes.length);}
 public void close(){try{socket.close();}catch(IOException ignored){}reader.interrupt();incoming.clear();ended=true;}
}
