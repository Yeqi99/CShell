import { connect } from 'node:net';
import { networkProbeSchema, type NetworkProbeResult } from '../shared/network-probe';

/** A TCP handshake measured on the actual source machine, including its DNS lookup.
 * It sends no application payload and never substitutes a different source. */
export async function probeNetwork(input: unknown, signal: AbortSignal): Promise<NetworkProbeResult> {
  const config = networkProbeSchema.parse(input);
  const startedAt = Date.now();
  const samples: NetworkProbeResult['samples'] = [];
  for (let i = 0; i < config.samples; i++) {
    signal.throwIfAborted();
    samples.push(await new Promise<NetworkProbeResult['samples'][number]>((resolve, reject) => {
      const began = performance.now();
      const socket = connect({ host: config.host.replace(/^\[|\]$/g, ''), port: config.port });
      let finished = false;
      const finish = (error?: Error & { code?: string }) => {
        if (finished) return;
        finished = true; clearTimeout(timeout); signal.removeEventListener('abort', cancel);
        socket.destroy();
        if (signal.aborted) { reject(signal.reason); return; }
        resolve(error ? { elapsedMs: null, error: error.code === 'ECONNREFUSED' ? '目标端口拒绝连接' : error.code === 'ENOTFOUND' ? '无法解析目标地址' : error.code === 'ETIMEDOUT' ? '连接超时' : '目标网络不可达或连接失败' } : { elapsedMs: Math.round((performance.now() - began) * 100) / 100 });
      };
      const cancel = () => finish();
      const timeout = setTimeout(() => finish(Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' })), config.timeoutMs);
      socket.once('connect', () => finish());
      socket.once('error', finish);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    }));
  }
  const times = samples.flatMap(sample => sample.elapsedMs === null ? [] : [sample.elapsedMs]);
  return { method: 'tcp-connect', host: config.host, port: config.port, startedAt, samples,
    minimumMs: times.length ? Math.min(...times) : null,
    averageMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length * 100) / 100 : null,
    maximumMs: times.length ? Math.max(...times) : null, failed: samples.length - times.length };
}
