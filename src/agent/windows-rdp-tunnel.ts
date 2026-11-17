import {connect, type Socket} from 'node:net';
import {rdpCertificate} from '../core/rdp-certificate';
import {ownsWindowsRdpSocket,windowsRdpListener} from './windows-rdp-listener';
import {once} from 'node:events';

// There is no destination argument on this wire operation. The Windows service
// chooses its own port and the authenticated client negotiates its own RDP TLS.
export class WindowsRdpTunnel {
  private active=0;
  constructor(private readonly listener=windowsRdpListener,private readonly probe=rdpCertificate,private readonly owns=ownsWindowsRdpSocket) {}

  async accept(peer:Socket, allowed:()=>boolean) {
    if(this.active>=4 || peer.destroyed || !allowed()) {peer.destroy();return;}
    this.active++;
    let upstream:Socket|undefined;
    const close=()=>{peer.destroy();upstream?.destroy();};
    const timer=setInterval(()=>{if(!allowed())close();},500);
    timer.unref();
    peer.once('error',close);
    peer.once('close',close);
    try {
      const {port,sha256}=await this.listener();
      if(peer.destroyed || !allowed() || await this.probe('127.0.0.1',port)!==sha256) return;
      if(peer.destroyed || !allowed())return;
      upstream=connect({host:'127.0.0.1',port});
      upstream.once('error',close);
      upstream.once('close',close);
      const abort=new AbortController();
      const closed=()=>abort.abort();
      peer.once('close',closed);
      try {
        await once(upstream,'connect',{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(5000)])});
        if(!upstream.localPort||!await this.owns(port,upstream.localPort))return;
      } finally {
        peer.off('close',closed);
      }
      if(peer.destroyed||upstream.destroyed||!allowed())return;
      upstream.setNoDelay();
      upstream.pipe(peer);
      peer.pipe(upstream);
      await new Promise<void>(resolve=>peer.once('close',resolve));
    } finally {
      clearInterval(timer);
      close();
      this.active--;
    }
  }
}
