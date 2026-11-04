import { spawn, type ChildProcess } from 'node:child_process';

export class WechatValidationUnknownError extends Error {
  readonly code = 'WECHAT_NATIVE_VALIDATION_UNKNOWN';
  constructor() { super('WECHAT_NATIVE_VALIDATION_UNKNOWN: native cleanup is unconfirmed; do not retry or reconfigure'); }
}

/** A timeout bounds our wait, never the lifetime of an injected native callback. */
export class ManagedWechatValidation {
  private poisoned = false;
  private child?: ChildProcess;
  get unknown() { return this.poisoned; }
  async run(executable: string, args: string[], options: { waitMs?: number; outputBytes?: number } = {}): Promise<unknown> {
    if (this.poisoned || this.child) throw new WechatValidationUnknownError();
    return new Promise((resolve, reject) => {
      let settled = false, bytes = 0;
      const chunks: Buffer[] = [];
      const unknown = () => {
        if (settled) return;
        settled = true; this.poisoned = true; chunks.length = 0;
        clearTimeout(timer);
        // Keep draining stdout/stderr, and keep the child referenced. Never kill,
        // disconnect, unref, or destroy streams while cleanup is uncertain.
        reject(new WechatValidationUnknownError());
      };
      const timer = setTimeout(unknown, options.waitMs ?? 30000);
      try {
        const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        this.child = child;
        child.stdout!.on('data', (data: Buffer) => {
          if (settled) return;
          bytes += data.length;
          if (bytes > (options.outputBytes ?? 1048576)) { unknown(); return; }
          chunks.push(data);
        });
        child.stderr!.on('data', (data: Buffer) => {
          if (settled) return;
          bytes += data.length;
          if (bytes > (options.outputBytes ?? 1048576)) unknown();
        });
        child.on('error', unknown);
        child.on('close', code => {
          this.child = undefined;
          if (settled) return; // Exit alone never clears an unknown native outcome.
          if (code !== 0) { unknown(); return; }
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const cleanup = result?.cleanup;
            if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.validated !== 'boolean' || (result.validated && (!cleanup || cleanup.retained !== false || cleanup.unloaded !== true || cleanup.codeRestored !== true || !Array.isArray(cleanup.errors) || cleanup.errors.length !== 0)) || (cleanup && (cleanup.retained || cleanup.unloaded !== true || cleanup.codeRestored !== true || cleanup.errors?.length))) { unknown(); return; }
            settled = true; clearTimeout(timer); chunks.length = 0; resolve(result);
          } catch { unknown(); }
        });
      } catch { unknown(); }
    });
  }
}
