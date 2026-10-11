import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { ClientChannel } from 'ssh2';
import type { SshService } from './ssh';
import type { RemoteJob } from '../shared/plugins';

export const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
export class RemoteJobs {
  private records = new Map<
    string,
    { job: RemoteJob; channel?: ClientChannel; cancel: () => void }
  >();
  constructor(private ssh: SshService) {}
  list(sessionId: string) {
    return [...this.records.values()]
      .filter((r) => r.job.sessionId === sessionId)
      .map((r) => ({ ...r.job }));
  }
  cancel(id: string) {
    const record = this.records.get(id);
    if (record?.job.state === 'running') record.cancel();
  }
  start(sessionId: string, label: string, command: string, input?: string) {
    this.ssh.get(sessionId);
    if (this.list(sessionId).some((j) => j.state === 'running'))
      throw new Error('A task is already running on this server');
    if (this.records.size >= 100) {
      for (const [id, r] of this.records) {
        if (r.job.state !== 'running') this.records.delete(id);
        if (this.records.size < 80) break;
      }
    }
    if (this.records.size >= 100) throw new Error('Too many running tasks');
    const job: RemoteJob = {
      id: randomUUID(),
      sessionId,
      label,
      state: 'running',
      output: '',
      started: Date.now(),
    };
    const controller = new AbortController();
    this.records.set(job.id, {
      job,
      cancel: () => {
        job.state = 'cancelled';
        controller.abort();
      },
    });
    void this.exec(
      sessionId,
      command,
      input,
      30 * 60_000,
      (text) => {
        job.output = (job.output + text).slice(-100_000);
      },
      controller.signal,
    ).then(
      () => {
        if (job.state === 'running') job.state = 'succeeded';
      },
      (error) => {
        if (job.state === 'running') {
          job.state = 'failed';
          job.output += '\n' + String(error.message);
        }
      },
    );
    return { ...job };
  }
  exec(
    sessionId: string,
    command: string,
    input?: string,
    timeout = 15000,
    output?: (s: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const client = this.ssh.get(sessionId).client;
    return new Promise((resolve, reject) => {
      let stream: ClientChannel | undefined,
        result = '',
        errors = '',
        settled = false;
      const decoder = new StringDecoder('utf8'),
        errDecoder = new StringDecoder('utf8');
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        client.off('close', disconnected);
        signal?.removeEventListener('abort', cancelled);
        if (error) {
          stream?.signal('TERM');
          stream?.close();
          reject(error);
        } else resolve(result);
      };
      const disconnected = () => finish(new Error('SSH connection closed'));
      const cancelled = () => finish(new Error('Task cancelled'));
      const timer = setTimeout(() => finish(new Error('Remote task timed out')), timeout);
      client.once('close', disconnected);
      signal?.addEventListener('abort', cancelled, { once: true });
      if (signal?.aborted) {
        cancelled();
        return;
      }
      client.exec(command, (error, channel) => {
        if (error) return finish(error);
        stream = channel;
        if (settled) {
          channel.close();
          return;
        }
        channel.on('data', (data: Buffer) => {
          const text = decoder.write(data);
          output?.(text);
          result = result + text;
          if (result.length > 2_000_000) {
            if (output) result = result.slice(-100_000);
            else finish(new Error('Remote output exceeds limit'));
          }
        });
        channel.stderr.on('data', (data: Buffer) => {
          const text = errDecoder.write(data);
          errors = (errors + text).slice(-8000);
          output?.(text);
        });
        channel.on('error', finish);
        channel.on('close', (code: number | undefined) =>
          finish(
            code === 0
              ? undefined
              : new Error(errors.trim() || `Remote command failed (${code ?? 'disconnected'})`),
          ),
        );
        channel.end(input ?? '');
      });
    });
  }
}
