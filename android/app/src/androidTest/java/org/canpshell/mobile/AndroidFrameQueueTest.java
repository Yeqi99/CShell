package org.canpshell.mobile;

/** Deterministic clock exercises delay and bounded H264 dependency recovery without a screen grant. */
final class AndroidFrameQueueTest {
  private static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
  static void run(){
    AndroidFrameQueue q=new AndroidFrameQueue();byte[] key={1},delta={2};
    check(!q.offer(delta,0,false,0),"delta before key");
    check(q.offer(key,1,true,0),"key rejected");check(q.poll(0).key,"initial key");
    check(q.offer(delta,2,false,30_000_000),"queued delta");check(q.offer(delta,3,false,60_000_000),"second delta");
    check(!q.poll(60_000_000).key&&!q.poll(60_000_000).key,"ACK waiting broke chain");
    q.offer(delta,4,false,70_000_000);check(q.poll(200_000_001)==null&&q.needsKey(),"stale delta delivered");
    check(!q.offer(delta,5,false,210_000_000),"broken successor accepted");
    q.offer(key,6,true,220_000_000);q.reset();check(q.poll(220_000_000)==null&&q.needsKey(),"rotation retained old configuration");
    for(int rtt:new int[]{20,60,150}){
      q.reset();long nextAck=0;int delivered=0,deltas=0;boolean forced=true;
      for(int ms=0;ms<3000;ms++){
        long now=ms*1_000_000L;
        if(ms%33==0){boolean k=forced||q.needsKey();q.offer(k?key:delta,ms,k,now);forced=false;}
        if(ms>=nextAck){AndroidFrameQueue.Frame f=q.poll(now);if(f!=null){check(now-f.queuedAt<=AndroidFrameQueue.MAX_AGE_NS,"unbounded video age");delivered++;if(!f.key)deltas++;nextAck=ms+rtt;}else if(q.needsKey())forced=true;}
      }
      check(delivered>=3000/(rtt+33)-2,"video starvation at RTT "+rtt);
      if(rtt<=60)check(deltas>5,"delta chain lost at RTT "+rtt);
      System.out.println("RTT_MS="+rtt+" delivered="+delivered+" deltas="+deltas+" maxQueuedAgeMs=120");
    }
  }
  public static void main(String[] args){run();}
}
