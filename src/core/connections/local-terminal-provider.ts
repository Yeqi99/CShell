import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { IPty } from 'node-pty';
import type { ManagedProvider } from './manager';
import type { ProviderConnection } from './contracts';
import type { SessionEvent } from '../../shared/contracts';
import {
  localShellSchema,
  localEnvironmentSchema,
  type LocalEnvironment,
} from '../../shared/local-terminal';
import type { Store } from '../store';
const exec = promisify(execFile);
/** Windows names are case-insensitive; overrides never mutate process.env or the registry. */
export function mergeEnvironment(
  base: Record<string, string | undefined>,
  overrides: LocalEnvironment,
) {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(base))
    if (value !== undefined) result[name.toUpperCase()] = value;
  for (const { name, value } of localEnvironmentSchema.parse(overrides))
    result[name.toUpperCase()] = value;
  return result;
}
export class LocalTerminalProvider implements ManagedProvider {
  readonly id = 'cshell.local-terminal';
  readonly version = '0.1.0';
  readonly capabilities = ['terminal.interactive'];
  readonly configuration = localShellSchema;
  private sessions = new Map<
    string,
    { pty: IPty; connection: ProviderConnection; outstanding: number }
  >();
  private overrides: LocalEnvironment = [];
  private writes = Promise.resolve();
  constructor(
    private directory: string,
    private store: Store,
    private emit: (event: SessionEvent) => void,
  ) {}
  async load() {
    try {
      this.overrides = localEnvironmentSchema.parse(
        JSON.parse(
          await this.store.decryptPrivate(
            await readFile(join(this.directory, 'local-environment.enc'), 'utf8'),
          ),
        ),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  async environment() {
    if (process.platform !== 'win32') return {};
    // Refresh registry-backed user/system variables for every newly opened terminal.
    const script = `[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); $m=@{}; [Environment]::GetEnvironmentVariables('Machine').GetEnumerator() | ForEach-Object {$m[$_.Key]=$_.Value}; $u=[Environment]::GetEnvironmentVariables('User'); $u.GetEnumerator() | ForEach-Object {if($_.Key -ieq 'Path') {$m['Path']=$m['Path']+';'+$_.Value} else {$m[$_.Key]=$_.Value}}; ConvertTo-Json -Compress -InputObject $m`;
    const { stdout } = await exec(
      join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      {
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          PSModulePath: join(
            process.env.SystemRoot || 'C:/Windows',
            'System32/WindowsPowerShell/v1.0/Modules',
          ),
        },
      },
    );
    const registry = JSON.parse(stdout.trim()) as Record<string, string>;
    const base = mergeEnvironment(
      process.env,
      Object.entries(registry).map(([name, value]) => ({ name, value })),
    );
    // These launcher flags belong to Electron, not to a user's shell.
    delete base.ELECTRON_RUN_AS_NODE;
    delete base.CSHELL_TEST_DATA;
    return base;
  }
  async settings() {
    return {
      supported: process.platform === 'win32',
      overrides: this.overrides,
      inherited: Object.entries(await this.environment()).map(([name, value]) => ({ name, value })),
    };
  }
  async save(value: unknown) {
    const next = localEnvironmentSchema.parse(value);
    const operation = this.writes.then(async () => {
      const encrypted = await this.store.encryptPrivate(JSON.stringify(next));
      const path = join(this.directory, 'local-environment.enc');
      await writeFile(path + '.tmp', encrypted, 'utf8');
      await rename(path + '.tmp', path);
      this.overrides = next;
    });
    this.writes = operation.catch(() => {});
    await operation;
  }
  async distributions(): Promise<{ available: boolean; distributions: string[]; error?: string }> {
    if (process.platform !== 'win32')
      return { available: false, distributions: [], error: '此插件需要 Windows WSL。' };
    try {
      const result = await exec(
        join(process.env.SystemRoot || 'C:/Windows', 'System32', 'wsl.exe'),
        ['--list', '--quiet'],
        { windowsHide: true, timeout: 12000, encoding: 'buffer', maxBuffer: 1024 * 1024 },
      );
      const text = result.stdout.includes(0)
        ? result.stdout.toString('utf16le')
        : result.stdout.toString('utf8');
      return {
        available: true,
        distributions: text
          .replace(/\u001b\[[0-9;]*m/g, '')
          .split(/\r?\n/)
          .map((s) => s.replace(/^[\s\uFEFF*]+|\s+$/g, ''))
          .filter(Boolean),
      };
    } catch {
      return {
        available: false,
        distributions: [],
        error: '未检测到可用的 WSL 发行版。请先安装或启用 WSL。',
      };
    }
  }
  async connect(value: unknown, _credentials: unknown, signal: AbortSignal) {
    if (process.platform !== 'win32') throw new Error('本机 CMD / PowerShell 仅支持 Windows');
    const shell = localShellSchema.parse(value);
    const distro = shell.startsWith('wsl:') ? shell.slice(4) : undefined;
    if (
      distro &&
      (!this.store.snapshot().plugins.some((p) => p.enabled && p.manifest.id === 'cshell.wsl') ||
        !(await this.distributions()).distributions.includes(distro))
    )
      throw new Error('请启用 WSL 插件并选择已安装的发行版');
    const env = mergeEnvironment(await this.environment(), this.overrides);
    signal.throwIfAborted();
    const { spawn } = await import('node-pty');
    const root = process.env.SystemRoot || 'C:\\Windows';
    const pty = spawn(
      distro
        ? join(root, 'System32', 'wsl.exe')
        : shell === 'cmd'
          ? join(root, 'System32', 'cmd.exe')
          : join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      distro
        ? ['--distribution', distro, '--cd', '~', '--exec', '/bin/bash', '-l']
        : shell === 'cmd'
          ? ['/d']
          : ['-NoLogo'],
      { name: 'xterm-256color', cols: 100, rows: 30, cwd: homedir(), env, useConpty: true },
    );
    const id = randomUUID();
    const connection: ProviderConnection = {
      target: {
        providerId: this.id,
        resourceId: id,
        identity: id,
        label: distro ? `WSL · ${distro}` : shell === 'cmd' ? '本机 CMD' : '本机 PowerShell',
      },
      tools: [],
      terminal: {
        input: (data) => pty.write(data),
        resize: (cols, rows) => pty.resize(cols, rows),
        acknowledge: (count) => {
          const s = this.sessions.get(id);
          if (s) {
            s.outstanding = Math.max(0, s.outstanding - count);
            if (s.outstanding < 250000) pty.resume();
          }
        },
      },
    };
    const session = { pty, connection, outstanding: 0 };
    this.sessions.set(id, session);
    pty.onData((data) => {
      session.outstanding += data.length;
      if (session.outstanding > 500000) pty.pause();
      this.emit({ type: 'data', sessionId: id, data });
    });
    pty.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      this.emit({
        type: 'closed',
        sessionId: id,
        ...(exitCode ? { error: `进程退出 (${exitCode})` } : {}),
      });
    });
    return id;
  }
  resolve(id: string) {
    const s = this.sessions.get(id);
    if (!s) throw new Error('本机终端已关闭');
    return s.connection;
  }
  disconnect(id: string) {
    this.sessions.get(id)?.pty.kill();
  }
  get size() {
    return this.sessions.size;
  }
  dispose() {
    for (const id of this.sessions.keys()) this.disconnect(id);
  }
}
