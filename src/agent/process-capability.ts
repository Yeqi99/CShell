import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { agentCapabilityManifestSchema, type AgentCapabilityManifest } from '../shared/agent-capability-packages';
import { verifyCapabilityFiles } from './capability-packages';
import type { TrustedCapabilityAdapter } from './capability-runtime';

const replySchema = z.object({ protocol: z.literal(1), id: z.string().uuid(), result: z.unknown() }).strict();
const inputLimit = 64 * 1024;

/** One request per child. No renderer JS, inherited secrets, shell interpolation or implicit grants.
 * An approved extension still runs with this OS user's privileges; this is NOT a security sandbox.
 */
export class ProcessCapabilityAdapter implements TrustedCapabilityAdapter {
  private readonly manifest: AgentCapabilityManifest;
  private root?: string;
  private generation = 0;
  private grants = new Set<string>();
  private active = new Set<AbortController>();
  private pending = new Set<Promise<unknown>>();
  constructor(manifest: AgentCapabilityManifest, private executable = process.execPath) {
    this.manifest = agentCapabilityManifestSchema.parse(manifest);
    if (!this.manifest.process) throw new Error('Process capability declaration required');
    // Compile schemas before any code can be launched, including packages with unavailable tools.
    for (const tool of this.manifest.tools) {
      z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]);
      z.fromJSONSchema(tool.outputSchema as Parameters<typeof z.fromJSONSchema>[0]);
    }
  }
  async inspect(root: string) {
    await verifyCapabilityFiles(root, this.manifest);
    return { installed: true, configured: true };
  }
  async register(root: string, grants: readonly string[]) {
    await this.quiesce();
    this.root = await verifyCapabilityFiles(root, this.manifest);
    this.grants = new Set(grants);
    this.generation++;
  }
  async quiesce() {
    this.root = undefined; this.grants.clear(); this.generation++;
    for (const controller of this.active) controller.abort(new Error('Extension authorization revoked'));
    await Promise.allSettled([...this.pending]);
  }
  async stop() { await this.quiesce(); }
  async unregister() { await this.quiesce(); }
  invoke(toolId: string, args: unknown, _owner: string, signal: AbortSignal): Promise<unknown> {
    const config = this.manifest.process!, tool = this.manifest.tools.find(item => item.id === toolId);
    if (!this.root || !tool || !tool.permissions.every(permission => this.grants.has(permission))) return Promise.reject(new Error('Extension is not authorized'));
    if (this.active.size >= config.maxConcurrency) return Promise.reject(new Error('Extension concurrency limit reached'));
    const controller = new AbortController(), root = this.root, generation = this.generation;
    this.active.add(controller);
    const operation = this.execute(root, generation, tool, args, AbortSignal.any([signal, controller.signal]));
    this.pending.add(operation);
    void operation.finally(() => { this.active.delete(controller); this.pending.delete(operation); }).catch(() => {});
    return operation;
  }
  private async execute(root: string, generation: number, tool: AgentCapabilityManifest['tools'][number], args: unknown, signal: AbortSignal) {
    signal.throwIfAborted();
    const parsed = z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]).parse(args);
    const id = randomUUID(), request = JSON.stringify({ protocol: 1, id, tool: tool.id, args: parsed }) + '\n';
    if (Buffer.byteLength(request) > inputLimit) throw new Error('Extension input exceeds 64 KiB');
    await verifyCapabilityFiles(root, this.manifest);
    signal.throwIfAborted();
    if (this.root !== root || generation !== this.generation) throw new Error('Extension authorization changed');
    const config = this.manifest.process!;
    const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' };
    for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LANG']) if (process.env[key]) env[key] = process.env[key];
    const child = spawn(this.executable, ['--no-addons', join(root, ...config.entry.split('/'))], {
      cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true, detached: process.platform !== 'win32',
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let terminate: Promise<void> | undefined;
    try {
      const output = await new Promise<string>((resolve, reject) => {
        let bytes = 0, stderrBytes = 0, chunks: Buffer[] = [], finished = false;
        const fail = (error: Error) => { if (finished) return; finished = true; terminate ??= stopChild(child); reject(error); };
        const abort = () => fail(new Error('Extension invocation cancelled'));
        signal.addEventListener('abort', abort, { once: true });
        child.once('close', code => {
          signal.removeEventListener('abort', abort);
          if (finished) return; finished = true;
          if (code !== 0) reject(new Error('Extension process failed')); else resolve(Buffer.concat(chunks).toString('utf8'));
        });
        child.once('error', () => fail(new Error('Extension process could not start')));
        child.stdin!.on('error', () => fail(new Error('Extension input channel failed')));
        child.stdout!.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > config.maxOutputBytes) fail(new Error('Extension output limit exceeded')); else chunks.push(chunk);
        });
        // Diagnostics are bounded and intentionally never forwarded to models or logs.
        child.stderr!.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 65536) fail(new Error('Extension diagnostic output limit exceeded')); });
        timer = setTimeout(() => fail(new Error('Extension execution timed out')), config.timeoutMs);
        if (signal.aborted) abort(); else child.stdin!.end(request);
      });
      signal.throwIfAborted();
      if (generation !== this.generation || this.root !== root) throw new Error('Extension authorization changed');
      let reply: z.infer<typeof replySchema>;
      try { reply = replySchema.parse(JSON.parse(output)); } catch { throw new Error('Extension returned an invalid JSON response'); }
      if (reply.id !== id) throw new Error('Extension response does not match this invocation');
      try { return z.fromJSONSchema(tool.outputSchema as Parameters<typeof z.fromJSONSchema>[0]).parse(reply.result); }
      catch { throw new Error('Extension result does not match its declared schema'); }
    } finally { clearTimeout(timer); await (terminate ?? stopChild(child)); }
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    if (child.exitCode !== null || child.signalCode) return;
    // Only our just-spawned process tree, never a user supplied PID or shell command.
    await new Promise<void>(resolve => {
      const killer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
      const timeout = setTimeout(() => { killer.kill(); child.kill(); resolve(); }, 2000);
      const done = () => { clearTimeout(timeout); resolve(); };
      killer.once('error', () => { child.kill(); done(); }); killer.once('exit', done);
    });
  } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } }
}
