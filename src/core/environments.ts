import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import type { ClientChannel } from 'ssh2';
import { z } from 'zod';
import type { SshService } from './ssh';
import { RemoteJobs, quote } from './remote-jobs';
import {
  environmentActionSchema,
  remoteExecutable,
  type EnvironmentAction,
  type EnvironmentSnapshot,
  type PythonAnalysis,
} from '../shared/plugins';

export const analysisScript = `import json,sys,ast
r=json.load(sys.stdin)
try:
 import jedi
except ImportError:
 sys.stderr.write('JEDI_MISSING: Install the Python completion engine in this environment.');sys.exit(3)
s=jedi.Script(code=r['code'],path=r.get('path'))
items=s.complete(r['line'],r['column'])
signatures=s.get_signatures(r['line'],r['column'])
errors=s.get_syntax_errors()
print(json.dumps({'completions':[{'label':x.name,'detail':x.description,'type':x.type} for x in items[:100]],'signatures':[x.to_string() for x in signatures],'diagnostics':[{'line':x.line,'column':x.column,'endLine':x.until_line,'endColumn':x.until_column,'message':x.get_message()} for x in errors]}))
`;
export class EnvironmentService {
  private notebooks = new Map<
    string,
    {
      server: Server;
      channel: ClientChannel;
      sockets: Set<import('node:net').Socket>;
      url: string;
      port: number;
      ready: boolean;
    }
  >();
  constructor(
    private ssh: SshService,
    private jobs: RemoteJobs,
  ) {}
  async inspect(sessionId: string): Promise<EnvironmentSnapshot> {
    const detected = await this.jobs.exec(
      sessionId,
      `# cshell:environment-detect\ncommand -v python3 || true\nfor p in "$(command -v conda 2>/dev/null)" "$HOME/miniconda3/bin/conda" "$HOME/anaconda3/bin/conda" "$HOME/miniforge3/bin/conda" /opt/conda/bin/conda; do if [ -n "$p" ] && [ -x "$p" ]; then printf 'CONDA=%s\\n' "$p"; break; fi; done`,
    );
    const lines = detected
      .trim()
      .split('\n')
      .map((s) => s.trim());
    const conda = lines.find((s) => s.startsWith('CONDA='))?.slice(6) || null;
    const python = lines.find((s) => s.startsWith('/')) || null;
    if (conda) remoteExecutable.parse(conda);
    if (python) remoteExecutable.parse(python);
    const environments: EnvironmentSnapshot['environments'] = [];
    if (conda) {
      const info = z
        .object({ envs: z.array(remoteExecutable).max(500) })
        .parse(JSON.parse(await this.jobs.exec(sessionId, `${quote(conda)} env list --json`)));
      for (const prefix of info.envs)
        environments.push({
          prefix,
          python: `${prefix}/bin/python`,
          name: prefix.split('/').pop() || prefix,
        });
    }
    return { conda, python, environments };
  }
  async known(sessionId: string, conda: string, prefix?: string) {
    const snapshot = await this.inspect(sessionId);
    if (
      snapshot.conda !== conda ||
      (prefix && !snapshot.environments.some((e) => e.prefix === prefix))
    )
      throw new Error('Environment is no longer available on this server');
    return snapshot;
  }
  async action(sessionId: string, input: EnvironmentAction, beforeStart: () => void = () => {}) {
    const action = environmentActionSchema.parse(input);
    beforeStart();
    if (action.type === 'install')
      return this.jobs.start(
        sessionId,
        'Install Python packages',
        `${quote(action.python)} -m pip install --disable-pip-version-check ${action.packages.map(quote).join(' ')}`,
      );
    await this.known(sessionId, action.conda, action.type === 'remove' ? action.prefix : undefined);
    beforeStart();
    if (action.type === 'create')
      return this.jobs.start(
        sessionId,
        `Create ${action.name}`,
        `${quote(action.conda)} create --yes --name ${quote(action.name)} ${quote('python=' + action.version)}`,
      );
    const base = (await this.jobs.exec(sessionId, `${quote(action.conda)} info --base`)).trim();
    if (base === action.prefix) throw new Error('The base environment cannot be removed');
    if (this.notebooks.has(`${sessionId}:${action.prefix}/bin/python`))
      throw new Error('Stop Jupyter before removing this environment');
    beforeStart();
    return this.jobs.start(
      sessionId,
      `Remove ${action.prefix}`,
      `${quote(action.conda)} env remove --yes --prefix ${quote(action.prefix)}`,
    );
  }
  async packages(sessionId: string, python: string) {
    const text = await this.jobs.exec(
      sessionId,
      `${quote(remoteExecutable.parse(python))} -m pip list --format=json --disable-pip-version-check`,
    );
    return z
      .array(z.object({ name: z.string(), version: z.string() }))
      .max(10000)
      .parse(JSON.parse(text));
  }
  async analyze(
    sessionId: string,
    python: string,
    code: string,
    line: number,
    column: number,
    path?: string,
  ): Promise<PythonAnalysis> {
    remoteExecutable.parse(python);
    if (path !== undefined) remoteExecutable.refine((p) => p.endsWith('.py')).parse(path);
    z.string().max(300_000).parse(code);
    z.number().int().min(1).max(300_000).parse(line);
    z.number().int().min(0).max(300_000).parse(column);
    const sourceLine = code.split('\n')[line - 1];
    if (sourceLine === undefined || column > [...sourceLine].length)
      throw new Error('Invalid completion position');
    const text = await this.jobs.exec(
      sessionId,
      `${quote(python)} -c ${quote(analysisScript)}`,
      JSON.stringify({ code, line, column, path }),
      15000,
    );
    return z
      .object({
        completions: z
          .array(z.object({ label: z.string(), detail: z.string(), type: z.string() }))
          .max(100),
        signatures: z.array(z.string()).max(100),
        diagnostics: z
          .array(
            z.object({
              line: z.number(),
              column: z.number(),
              endLine: z.number(),
              endColumn: z.number(),
              message: z.string(),
            }),
          )
          .max(1000),
      })
      .parse(JSON.parse(text));
  }
  private opening = new Map<string, AbortController>();
  async openTerminal(
    sessionId: string,
    conda: string,
    prefix: string,
    signal?: AbortSignal,
    ready?: (id: string) => void,
  ) {
    signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
    signal?.throwIfAborted();
    remoteExecutable.parse(conda);
    remoteExecutable.parse(prefix);
    await this.known(sessionId, conda, prefix);
    signal?.throwIfAborted();
    return this.ssh.openEnvironment(
      sessionId,
      `${quote(conda)} run --no-capture-output --prefix ${quote(prefix)} bash --noprofile --norc -i`,
      signal,
      ready,
    );
  }
  jupyterStatus(sessionId: string, python: string) {
    const item = this.notebooks.get(sessionId + ':' + python);
    return { running: !!item?.ready, port: item?.port };
  }
  async startJupyter(sessionId: string, python: string, port: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const key = sessionId + ':' + python;
    if (this.opening.has(key)) throw new Error('Jupyter is starting');
    const existing = this.notebooks.get(key);
    if (existing?.ready) {
      if (existing.port !== port) throw new Error('Jupyter is already running on a different port');
      return existing.url;
    }
    if (
      new Set([...this.opening.keys(), ...this.notebooks.keys()]).size >= 16 ||
      new Set(
        [...this.opening.keys(), ...this.notebooks.keys()].filter((k) =>
          k.startsWith(sessionId + ':'),
        ),
      ).size >= 4
    )
      throw new Error('Jupyter resource quota reached');
    const controller = new AbortController();
    const deadline = setTimeout(
      () => controller.abort(new Error('Jupyter startup timed out')),
      45000,
    );
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    this.opening.set(key, controller);
    try {
      return await this.startNotebook(sessionId, python, port, controller.signal);
    } finally {
      clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
      this.opening.delete(key);
    }
  }
  private async startNotebook(
    sessionId: string,
    python: string,
    port: number,
    signal: AbortSignal,
  ) {
    remoteExecutable.parse(python);
    z.number().int().min(1024).max(65535).parse(port);
    const key = `${sessionId}:${python}`,
      existing = this.notebooks.get(key);
    if (existing) return existing.url;
    const client = this.ssh.get(sessionId).client;
    // Probe the selected interpreter before opening a long-lived process.
    await this.jobs.exec(
      sessionId,
      `${quote(python)} -c 'import jupyterlab'`,
      undefined,
      15000,
      undefined,
      signal,
    );
    signal.throwIfAborted();
    if (this.ssh.get(sessionId).client !== client) throw new Error('Connection changed');
    const token = randomBytes(32).toString('hex');
    const sockets = new Set<import('node:net').Socket>();
    const server = createServer((socket) => {
      if (sockets.size >= 16) {
        socket.destroy();
        return;
      }
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      socket.on('error', () => socket.destroy());
      client.forwardOut('127.0.0.1', 0, '127.0.0.1', port, (error, channel) => {
        if (error || socket.destroyed) {
          channel?.destroy();
          socket.destroy();
          return;
        }
        channel.on('error', () => socket.destroy());
        socket.once('close', () => channel.destroy());
        socket.pipe(channel).pipe(socket);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const localPort = (server.address() as import('node:net').AddressInfo).port;
    try {
      signal.throwIfAborted();
      const channel = await new Promise<ClientChannel>((resolve, reject) => {
        const aborted = () => reject(signal.reason);
        signal.addEventListener('abort', aborted, { once: true });
        client.exec(
          `JUPYTER_TOKEN=${quote(token)} ${quote(python)} -m jupyterlab --no-browser --ServerApp.ip=127.0.0.1 --ServerApp.port=${port} --ServerApp.port_retries=0 --ServerApp.allow_root=True`,
          (error, stream) => {
            signal.removeEventListener('abort', aborted);
            // Server-supplied errors may echo the command containing the token.
            if (error) return reject(new Error('Jupyter process channel could not be opened'));
            if (signal.aborted) {
              stream.signal('TERM');
              stream.close();
              reject(signal.reason);
              return;
            }
            resolve(stream);
          },
        );
      });
      const url = `http://127.0.0.1:${localPort}/lab?token=${token}`;
      const cleanup = () => {
        server.close();
        for (const socket of sockets) socket.destroy();
        if (this.notebooks.get(key)?.channel === channel) this.notebooks.delete(key);
        client.off('close', onDisconnect);
      };
      const onDisconnect = () => {
        channel.destroy();
        cleanup();
      };
      this.notebooks.set(key, { server, channel, sockets, url, port, ready: false });
      client.once('close', onDisconnect);
      channel.once('close', cleanup);
      channel.on('error', cleanup);
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let output = '';
        const timeout = setTimeout(() => done(new Error('Jupyter startup timed out')), 30000);
        const done = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          channel.off('data', data);
          channel.stderr.off('data', data);
          channel.off('close', closed);
          signal.removeEventListener('abort', aborted);
          error ? reject(error) : resolve();
        };
        const data = (chunk: Buffer) => {
          output = (output + chunk.toString()).slice(-8000);
          if (/http:\/\/(127\.0\.0\.1|localhost):/.test(output)) done();
        };
        const closed = () =>
          done(new Error('Jupyter failed to start; check the port and environment.'));
        const aborted = () => done(new Error('Jupyter startup cancelled'));
        channel.on('data', data);
        channel.stderr.on('data', data);
        channel.once('close', closed);
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) aborted();
      });
      signal.throwIfAborted();
      if (this.ssh.get(sessionId).client !== client || this.notebooks.get(key)?.channel !== channel)
        throw new Error('Connection closed during Jupyter startup');
      this.notebooks.get(key)!.ready = true;
      channel.on('data', () => {});
      channel.stderr.on('data', () => {});
      return url;
    } catch (error) {
      this.stopJupyter(sessionId, python);
      server.close();
      throw error;
    }
  }
  stopJupyter(sessionId: string, python: string) {
    const key = `${sessionId}:${python}`,
      record = this.notebooks.get(key);
    this.opening.get(key)?.abort(new Error('Jupyter startup stopped'));
    if (record) {
      record.channel.signal('TERM');
      record.channel.close();
      record.server.close();
      for (const socket of record.sockets) socket.destroy();
      this.notebooks.delete(key);
    }
  }
  stopAllJupyter() {
    for (const controller of this.opening.values()) controller.abort(new Error('Jupyter disabled'));
    for (const key of [...this.notebooks.keys()]) {
      const separator = key.indexOf(':');
      this.stopJupyter(key.slice(0, separator), key.slice(separator + 1));
    }
  }
}
