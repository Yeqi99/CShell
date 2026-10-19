import { execFile, spawn as spawnProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { IPty } from 'node-pty';
import type { ManagedProvider } from './connections/manager';
import type { ProviderConnection } from './connections/contracts';
import type { SessionEvent } from '../shared/contracts';

const exec = promisify(execFile);
type WindowsPtyInternals = {
  _agent?: {
    _pty: number;
    _useConptyDll: boolean;
    _ptyNative: { kill(pty: number, dll: boolean): void };
    _conoutSocketWorker?: {
      dispose(): void;
      _worker?: { on(event: 'error', listener: (error: Error) => void): void };
    };
    _inSocket?: { destroy(): void };
    _outSocket?: { destroy(): void };
  };
};
const releasedWindowsPtys = new WeakSet<IPty>();
function releaseWindowsPty(pty: IPty) {
  const agent = (pty as unknown as WindowsPtyInternals)._agent;
  if (!agent || releasedWindowsPtys.has(pty)) return;
  releasedWindowsPtys.add(pty);
  // node-pty 1.1.0's public kill races its asynchronous AttachConsole helper.
  // The caller has already terminated this owned process tree (or observed exit).
  // Release the native handle before its draining worker and sockets.
  try {
    agent._ptyNative.kill(agent._pty, agent._useConptyDll);
  } catch {
    /* already exited */
  }
  agent._conoutSocketWorker?.dispose();
  agent._inSocket?.destroy();
  agent._outSocket?.destroy();
}
const terminalConfig = z.union([
  z.string().min(1).max(200),
  z
    .object({
      shell: z.string().min(1).max(32),
      distribution: z.string().min(1).max(120).optional(),
    })
    .strict(),
]);
export type AgentShell = {
  id: string;
  label: string;
  executable: string;
  args: string[];
  environment: 'host' | 'wsl';
  distribution?: string;
};
export async function detectAgentShells(): Promise<AgentShell[]> {
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows';
    const shells: AgentShell[] = [];
    for (const [id, executable, args, label] of [
      ['cmd', join(root, 'System32', 'cmd.exe'), ['/d'], 'CMD'],
      [
        'powershell',
        join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoLogo'],
        'PowerShell',
      ],
    ] as const) {
      try {
        await access(executable);
        shells.push({ id, executable, args: [...args], label, environment: 'host' });
      } catch {
        /* unavailable */
      }
    }
    try {
      const executable = join(root, 'System32', 'wsl.exe');
      const { stdout } = await exec(executable, ['--list', '--quiet'], {
        encoding: 'buffer',
        windowsHide: true,
        timeout: 12000,
        maxBuffer: 65536,
      });
      const text = stdout.includes(0) ? stdout.toString('utf16le') : stdout.toString('utf8');
      for (const distribution of text
        .replace(/\u001b\[[0-9;]*m/g, '')
        .split(/\r?\n/)
        .map((s) => s.replace(/^[\s\uFEFF*]+|\s+$/g, ''))
        .filter(Boolean)) {
        shells.push({
          id: 'wsl:' + distribution,
          label: 'WSL · ' + distribution,
          executable,
          args: ['--distribution', distribution, '--cd', '~'],
          environment: 'wsl',
          distribution,
        });
      }
    } catch {
      /* No WSL is a valid installation state. */
    }
    return shells;
  }
  let entries = ['/bin/bash', '/bin/zsh', '/bin/sh'];
  try {
    entries = [
      ...new Set([
        ...entries,
        ...(await readFile('/etc/shells', 'utf8'))
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s.startsWith('/')),
      ]),
    ];
  } catch {
    /* minimal systems */
  }
  const shells: AgentShell[] = [];
  for (const executable of entries) {
    const id = basename(executable);
    if (!['bash', 'zsh', 'sh'].includes(id) || shells.some((s) => s.id === id)) continue;
    try {
      await access(executable, constants.X_OK);
      shells.push({ id, label: id, executable, args: ['-l'], environment: 'host' });
    } catch {
      /* not installed */
    }
  }
  return shells;
}

/** Native persistent PTY, independent of SSH, Electron and renderer lifetime. */
export class AgentTerminalProvider implements ManagedProvider {
  readonly id = 'cshell.agent-terminal';
  readonly version = '1.0.0';
  readonly capabilities = ['terminal.interactive'];
  readonly configuration = terminalConfig;
  private closing = new Set<Promise<void>>();
  private sessions = new Map<
    string,
    {
      pty: IPty;
      connection: ProviderConnection;
      outstanding: number;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private emit: (event: SessionEvent) => void,
    private detect = detectAgentShells,
    private spawnPty?: typeof import('node-pty').spawn,
  ) {}
  shells() {
    return this.detect();
  }
  async execute(input: unknown, signal: AbortSignal, output?: (text:string)=>void) {
    const request = z
      .object({
        shell: z.enum(['cmd', 'powershell', 'bash', 'zsh', 'sh', 'wsl']),
        distribution: z.string().min(1).max(120).optional(),
        command: z.string().min(1).max(16384),
        timeoutMs: z.number().int().min(1).max(86400000).default(30000),
      })
      .strict()
      .parse(input);
    if (request.shell === 'wsl' && !request.distribution)
      throw new Error('必须选择真实 WSL 发行版');
    if (request.shell !== 'wsl' && request.distribution)
      throw new Error('主机命令不能附带 WSL 发行版');
    const combined = AbortSignal.any([signal, AbortSignal.timeout(request.timeoutMs)]);
    const id = request.shell === 'wsl' ? 'wsl:' + request.distribution : request.shell;
    const shell = (await this.detect()).find((s) => s.id === id);
    if (!shell) throw new Error('所选 Shell 或 WSL 发行版未安装');
    combined.throwIfAborted();
    const args =
      request.shell === 'wsl'
        ? ['--distribution', request.distribution!, '--exec', 'sh', '-lc', request.command]
        : request.shell === 'cmd'
          ? ['/d', '/s', '/c', request.command]
          : request.shell === 'powershell'
            ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', request.command]
            : ['-lc', request.command];
    return new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
      truncated: boolean;
      environment: string;
      distribution?: string;
    }>((resolve, reject) => {
      const child = spawnProcess(shell.executable, args, {
        cwd: homedir(),
        env: process.env,
        windowsHide: true,
        windowsVerbatimArguments: request.shell === 'cmd',
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const out: Buffer[] = [],
        err: Buffer[] = [];
      let length = 0,
        truncated = false,
        settled = false;
      const collect = (target: Buffer[]) => (chunk: Buffer) => {
        output?.(chunk.toString('utf8'));
        const available = Math.max(0, (output ? 4*1024*1024 : 65536) - length);
        if (chunk.length > available) truncated = true;
        if (available) {
          const kept = chunk.subarray(0, available);
          target.push(kept);
          length += kept.length;
        }
      };
      child.stdout.on('data', collect(out));
      child.stderr.on('data', collect(err));
      const abort = () => {
        if (!child.pid || settled) return;
        if (process.platform === 'win32')
          execFile(
            join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, timeout: 5000 },
            () => {},
          );
        else {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
      };
      combined.addEventListener('abort', abort, { once: true });
      if (combined.aborted) abort();
      child.once('error', (error) => {
        settled = true;
        combined.removeEventListener('abort', abort);
        reject(error);
      });
      child.once('close', (code) => {
        settled = true;
        combined.removeEventListener('abort', abort);
        if (combined.aborted) {
          reject(new Error(signal.aborted ? '命令已取消' : '命令执行超时'));
          return;
        }
        resolve({
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8'),
          exitCode: code ?? -1,
          truncated,
          environment: shell.environment,
          ...(shell.distribution ? { distribution: shell.distribution } : {}),
        });
      });
    });
  }
  async connect(value: unknown, _credentials: unknown, signal: AbortSignal) {
    const input = terminalConfig.parse(value);
    const id =
      typeof input === 'string'
        ? input
        : input.shell === 'wsl'
          ? 'wsl:' + input.distribution
          : input.shell;
    const shell = (await this.detect()).find((s) => s.id === id);
    if (!shell) throw new Error('所选 Shell 或 WSL 发行版未安装');
    signal.throwIfAborted();
    if (this.sessions.size >= 16) throw new Error('终端会话达到上限');
    const spawn = this.spawnPty ?? (await import('node-pty')).spawn;
    const env = Object.fromEntries(
      Object.entries(process.env).filter((v): v is [string, string] => v[1] !== undefined),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.CSHELL_AGENT_CONTROL_TOKEN;
    const pty = spawn(shell.executable, shell.args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: homedir(),
      env,
      useConpty: process.platform === 'win32',
    });
    const sessionId = randomUUID();
    const connection: ProviderConnection = {
      target: {
        providerId: this.id,
        resourceId: sessionId,
        identity: sessionId,
        label: shell.label,
      },
      tools: [],
      terminal: {
        input: (data) => {
          if (data.length > 32768) throw new Error('终端输入过长');
          pty.write(data);
        },
        resize: (cols, rows) =>
          pty.resize(Math.max(2, Math.min(500, cols)), Math.max(1, Math.min(300, rows))),
        acknowledge: (count) => {
          const session = this.sessions.get(sessionId);
          if (!session || !Number.isSafeInteger(count) || count < 0 || count > session.outstanding)
            return;
          session.outstanding -= count;
          if (session.outstanding < 131072) {
            clearTimeout(session.timer);
            session.timer = undefined;
            pty.resume();
          }
        },
      },
    };
    const session: {
      pty: IPty;
      connection: ProviderConnection;
      outstanding: number;
      timer?: ReturnType<typeof setTimeout>;
    } = { pty, connection, outstanding: 0 };
    this.sessions.set(sessionId, session);
    if (process.platform === 'win32') {
      // node-pty's relay worker may emit EPIPE while a busy terminal is closing.
      // An unobserved Worker error would otherwise terminate the whole Agent.
      (pty as unknown as WindowsPtyInternals)._agent?._conoutSocketWorker?._worker?.on(
        'error',
        () => {
          if (this.sessions.has(sessionId)) {
            void this.disconnect(sessionId);
            this.emit({ type: 'closed', sessionId, error: '终端输出通道已关闭' });
          }
        },
      );
    }
    pty.onData((data) => {
      session.outstanding += data.length;
      if (session.outstanding > 1048576) {
        this.disconnect(sessionId);
        return;
      }
      if (session.outstanding >= 262144) {
        pty.pause();
        session.timer ??= setTimeout(() => this.disconnect(sessionId), 60000);
        session.timer.unref();
      }
      this.emit({ type: 'data', sessionId, data });
    });
    pty.onExit(({ exitCode }) => {
      clearTimeout(session.timer);
      this.sessions.delete(sessionId);
      if (process.platform === 'win32') releaseWindowsPty(pty);
      this.emit({
        type: 'closed',
        sessionId,
        ...(exitCode ? { error: `进程退出 (${exitCode})` } : {}),
      });
    });
    if (signal.aborted) {
      this.disconnect(sessionId);
      signal.throwIfAborted();
    }
    return sessionId;
  }
  resolve(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('终端已断开');
    return session.connection;
  }
  disconnect(id: string) {
    const session = this.sessions.get(id);
    if (session) {
      clearTimeout(session.timer);
      this.sessions.delete(id);
      if (process.platform === 'win32' && (session.pty as unknown as WindowsPtyInternals)._agent) {
        const closing = new Promise<void>((resolve) => {
          execFile(
            join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/PID', String(session.pty.pid), '/T', '/F'],
            { windowsHide: true, timeout: 5000 },
            () => {
              releaseWindowsPty(session.pty);
              resolve();
            },
          );
        });
        this.closing.add(closing);
        void closing.then(() => this.closing.delete(closing));
        return closing;
      }
      session.pty.kill();
    }
  }
  get size() {
    return this.sessions.size;
  }
  async dispose() {
    for (const id of this.sessions.keys()) this.disconnect(id);
    await Promise.all(this.closing);
  }
}
