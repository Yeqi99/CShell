import {connect} from 'node:net';
import {connect as connectTls} from 'node:tls';
import {createHash} from 'node:crypto';

// Request an RDP TLS transport. No CredSSP, password or logon packet is sent.
const negotiate = Buffer.from('030000130ee000000000000100080003000000', 'hex');

export async function rdpCertificate(host: string, port: number, timeout = 4500): Promise<string> {
  const socket = connect({host, port});
  const timer = setTimeout(() => socket.destroy(new Error('RDP 握手超时')), timeout);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.once('connect', () => socket.write(negotiate));
      let response = Buffer.alloc(0);
      const read = (chunk: Buffer) => {
        response = Buffer.concat([response, chunk]);
        if (response.length < 4) return;
        const size = response.readUInt16BE(2);
        if (response[0] !== 3 || size !== 19 || response.length > size) return reject(Error('RDP 协商响应无效'));
        if (response.length < size) return;
        if (response[5] !== 0xd0 || response[11] !== 2 || ![1,2,8].includes(response.readUInt32LE(15))) return reject(Error('目标未提供 RDP TLS'));
        socket.off('data', read);
        resolve();
      };
      socket.on('data', read);
      socket.once('close', () => reject(Error('RDP 连接已关闭')));
    });
    // The authenticated CAgent supplies the expected fingerprint. Self-signed
    // Windows listener certificates are common. This probe only reads a cert.
    return await new Promise<string>((resolve, reject) => {
      const tls = connectTls({socket, rejectUnauthorized:false}, () => {
        const cert = tls.getPeerCertificate().raw;
        if (cert?.length) resolve(createHash('sha256').update(cert).digest('hex'));
        else reject(Error('RDP 未提供证书'));
        tls.destroy();
      });
      tls.once('error', reject);
      tls.once('close', () => reject(Error('RDP TLS 会话已关闭')));
    });
  } finally {
    clearTimeout(timer);
    socket.destroy();
  }
}
