import ssh2, { type Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import { createHash, randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { performance } from 'node:perf_hooks';
import type { FileEntry, Metrics, Profile, SessionEvent } from '../shared/contracts';
import { childPath, remotePath } from './paths';
import { metricsCommand, parseMetrics, type CpuSample } from './metrics';

export interface Session {
  profile: Profile;
  id: string;
  client: Client;
  shell?: ClientChannel;
  sftp?: SFTPWrapper;
  sftpPending?: Promise<SFTPWrapper>;
  cpu?: CpuSample;
  monitoring: boolean;
  closed: boolean;
  outstanding: number;
  parent?: string;
}
export class SshService {
  private sessions = new Map<string, Session>();
  get size() {
    return this.sessions.size;
  }
  constructor(
    private emit: (event: SessionEvent) => void,
    private verify: (profile: Profile, fingerprint: string) => Promise<boolean>,
  ) {}
  async connect(
    profile: Profile,
    credentials: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'>,
  ) {
    const client = new ssh2.Client();
    const session: Session = {
      profile: { ...profile },
      id: randomUUID(),
      client,
      monitoring: false,
      closed: false,
      outstanding: 0,
    };
    this.sessions.set(session.id, session);
    const decoder = new StringDecoder('utf8'),
      stderrDecoder = new StringDecoder('utf8');
    const close = (error?: string) => {
      if (session.closed) return;
      session.closed = true;
      this.sessions.delete(session.id);
      session.sftp?.end();
      session.shell?.destroy();
      client.destroy();
      this.emit({ type: 'closed', sessionId: session.id, error });
    };
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('ready', resolve);
        client.on('error', (error) => {
          reject(error);
          close(error.message);
        });
        client.once('close', () => {
          reject(new Error('SSH connection closed'));
          close();
        });
        client.connect({
          host: profile.host,
          port: profile.port,
          username: profile.username,
          ...credentials,
          readyTimeout: 120000,
          keepaliveInterval: 15000,
          keepaliveCountMax: 3,
          hostVerifier: (key: Buffer, callback: (valid: boolean) => void) => {
            const fingerprint =
              'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
            this.verify(profile, fingerprint).then(
              (ok) => callback(ok && !session.closed),
              () => callback(false),
            );
          },
        });
      });
      session.shell = await new Promise<ClientChannel>((resolve, reject) =>
        client.shell({ term: 'xterm-256color', cols: 100, rows: 30 }, (error, stream) =>
          error ? reject(error) : resolve(stream),
        ),
      );
      const output = (data: Buffer, decoderForStream: StringDecoder) => {
        const text = decoderForStream.write(data);
        session.outstanding += text.length;
        this.emit({ type: 'data', sessionId: session.id, data: text });
        if (session.outstanding > 1_000_000) {
          session.shell?.pause();
          session.shell?.stderr.pause();
        }
      };
      session.shell.on('data', (data: Buffer) => output(data, decoder));
      session.shell.stderr.on('data', (data: Buffer) => output(data, stderrDecoder));
      session.shell.once('close', () => close());
      session.shell.on('error', (error: Error) => close(error.message));
      return { sessionId: session.id };
    } catch (error) {
      close();
      throw error;
    }
  }
  get(id: string) {
    const session = this.sessions.get(id);
    if (!session || session.closed) throw new Error('Session is not connected');
    return session;
  }
  async openEnvironment(parentId: string, command: string) {
    const parent = this.get(parentId);
    const stream = await new Promise<ClientChannel>((resolve, reject) =>
      parent.client.exec(
        command,
        { pty: { term: 'xterm-256color', cols: 100, rows: 30 } },
        (error, stream) => (error ? reject(error) : resolve(stream)),
      ),
    );
    const child: Session = {
      profile: { ...parent.profile },
      id: randomUUID(),
      client: parent.client,
      shell: stream,
      parent: parentId,
      monitoring: false,
      closed: false,
      outstanding: 0,
    };
    this.sessions.set(child.id, child);
    const decoder = new StringDecoder('utf8');
    const close = () => {
      if (child.closed) return;
      child.closed = true;
      this.sessions.delete(child.id);
      parent.client.off('close', close);
      this.emit({ type: 'closed', sessionId: child.id });
    };
    stream.on('data', (data: Buffer) => {
      const text = decoder.write(data);
      child.outstanding += text.length;
      this.emit({ type: 'data', sessionId: child.id, data: text });
      if (child.outstanding > 1_000_000) stream.pause();
    });
    stream.stderr.on('data', (data: Buffer) =>
      this.emit({ type: 'data', sessionId: child.id, data: data.toString('utf8') }),
    );
    stream.on('error', close);
    stream.once('close', close);
    parent.client.once('close', close);
    return { sessionId: child.id };
  }
  disconnect(id: string) {
    const s = this.sessions.get(id);
    if (s) {
      if (s.parent) {
        s.shell?.signal('TERM');
        s.shell?.close();
        return;
      }
      s.shell?.end();
      s.client.end();
      s.client.destroy();
    }
  }
  dispose() {
    for (const id of this.sessions.keys()) this.disconnect(id);
  }
  input(id: string, data: string) {
    this.get(id).shell?.write(data);
  }
  acknowledge(id: string, characters: number) {
    const session = this.sessions.get(id);
    if (!session) return;
    session.outstanding = Math.max(0, session.outstanding - characters);
    if (session.outstanding < 250_000) {
      session.shell?.resume();
      session.shell?.stderr.resume();
    }
  }
  resize(id: string, cols: number, rows: number) {
    this.get(id).shell?.setWindow(rows, cols, 0, 0);
  }
  async sftp(id: string) {
    const session = this.get(id);
    if (session.sftp) return session.sftp;
    if (!session.sftpPending)
      session.sftpPending = new Promise<SFTPWrapper>((resolve, reject) =>
        session.client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp))),
      );
    try {
      session.sftp = await session.sftpPending;
      return session.sftp;
    } finally {
      session.sftpPending = undefined;
    }
  }
  async list(id: string, path: string) {
    const sftp = await this.sftp(id);
    const canonical = await new Promise<string>((resolve, reject) =>
      sftp.realpath(remotePath(path), (error, name) => (error ? reject(error) : resolve(name))),
    );
    const entries = await new Promise<FileEntry[]>((resolve, reject) =>
      sftp.readdir(canonical, (error, files) => {
        if (error) return reject(error);
        try {
          if (files.length > 50000) throw new Error('Directory entry limit exceeded');
          resolve(
            files
              .filter((f) => f.filename !== '.' && f.filename !== '..')
              .map((f) => ({
                name: f.filename,
                path: childPath(canonical, f.filename),
                directory: f.attrs.isDirectory(),
                symlink: f.attrs.isSymbolicLink(),
                size: f.attrs.size,
                modified: f.attrs.mtime * 1000,
              })),
          );
        } catch (error) {
          reject(error);
        }
      }),
    );
    entries.sort(
      (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
    );
    return { path: canonical, entries };
  }
  async action(
    id: string,
    action: 'mkdir' | 'rename' | 'delete',
    path: string,
    destination?: string,
  ) {
    const sftp = await this.sftp(id);
    remotePath(path);
    if (action === 'rename') {
      if (!destination) throw new Error('Missing destination');
      remotePath(destination);
      const exists = await new Promise<boolean>((resolve, reject) =>
        sftp.lstat(destination, (e) =>
          !e ? resolve(true) : (e as any).code === 2 ? resolve(false) : reject(e),
        ),
      );
      if (exists) throw new Error('Destination already exists');
    }
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error | null) => (error ? reject(error) : resolve());
      if (action === 'mkdir') sftp.mkdir(path, done);
      else if (action === 'rename') sftp.rename(path, destination!, done);
      else
        sftp.lstat(path, (error, stat) => {
          if (error) return reject(error);
          if (stat.isDirectory()) sftp.rmdir(path, done);
          else sftp.unlink(path, done);
        });
    });
  }
  async monitor(id: string): Promise<Metrics> {
    const session = this.get(id);
    if (session.monitoring) throw new Error('Monitoring request already running');
    session.monitoring = true;
    const start = performance.now();
    try {
      const output = await new Promise<string>((resolve, reject) => {
        let timedOut = false;
        let channel: ClientChannel | undefined,
          text = '';
        const timer = setTimeout(() => {
          timedOut = true;
          channel?.close();
          reject(new Error('Monitoring timed out'));
        }, 8000);
        session.client.exec(metricsCommand, (error, stream) => {
          if (error) {
            clearTimeout(timer);
            return reject(error);
          }
          if (timedOut) {
            stream.close();
            return;
          }
          channel = stream;
          stream.on('data', (data: Buffer) => {
            text += data.toString();
            if (text.length > 65536) {
              stream.close();
              reject(new Error('Monitoring output limit'));
            }
          });
          stream.on('error', (e: Error) => {
            clearTimeout(timer);
            reject(e);
          });
          stream.on('close', () => {
            clearTimeout(timer);
            resolve(text);
          });
        });
      });
      const parsed = parseMetrics(output, session.cpu);
      session.cpu = parsed.sample;
      return {
        cpu: parsed.cpu,
        cpuCount: parsed.cpuCount,
        memory: parsed.memory,
        memoryUsed: parsed.memoryUsed,
        memoryTotal: parsed.memoryTotal,
        disk: parsed.disk,
        diskUsed: parsed.diskUsed,
        diskTotal: parsed.diskTotal,
        latency: Math.round(performance.now() - start),
        ...(!parsed.sample ? { error: 'Linux /proc monitoring unavailable' } : {}),
      };
    } finally {
      session.monitoring = false;
    }
  }
}
