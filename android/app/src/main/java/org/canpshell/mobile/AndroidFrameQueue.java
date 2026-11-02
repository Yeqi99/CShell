package org.canpshell.mobile;

import java.util.ArrayDeque;

/** Short dependency-preserving H264 queue. Dropping a delta invalidates its successors. */
final class AndroidFrameQueue {
  static final int MAX_FRAMES=3, MAX_BYTES=32*1024*1024;
  static final long MAX_AGE_NS=120_000_000L;
  static final class Frame {
    final byte[] data; final long timestamp, queuedAt; final boolean key;
    Frame(byte[] data,long timestamp,boolean key,long now){this.data=data;this.timestamp=timestamp;this.key=key;queuedAt=now;}
  }
  private final ArrayDeque<Frame> queue=new ArrayDeque<>();
  private int bytes;
  private boolean needsKey=true;
  synchronized boolean offer(byte[] data,long timestamp,boolean key,long now){
    expire(now);
    if(data.length>MAX_BYTES){reset();return false;}
    if(key){queue.clear();bytes=0;needsKey=false;}
    if(needsKey&&!key)return false;
    if(queue.size()>=MAX_FRAMES||bytes+data.length>MAX_BYTES){reset();if(!key)return false;needsKey=false;}
    queue.addLast(new Frame(data.clone(),timestamp,key,now));bytes+=data.length;return true;
  }
  synchronized Frame poll(long now){expire(now);Frame frame=queue.pollFirst();if(frame!=null)bytes-=frame.data.length;return frame;}
  synchronized boolean needsKey(){return needsKey;}
  synchronized void reset(){queue.clear();bytes=0;needsKey=true;}
  private void expire(long now){if(!queue.isEmpty()&&now-queue.peekFirst().queuedAt>MAX_AGE_NS)reset();}
}
