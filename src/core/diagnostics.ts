import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Local failures only: never pass IPC arguments, terminal output or request bodies. */
export function diagnosticText(value: string): string {
  return value.slice(0, 12000)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[private key]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[authorization]')
    .replace(/\b(?:sk-|tvly-)[a-zA-Z0-9_-]+/g, '[api key]')
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[token]')
    .replace(/((?:password|passwd|secret|token|api[_-]?key|authorization|cookie)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, text => { try { const url = new URL(text); return `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}/[path omitted]`; } catch { return '[url]'; } })
    .split(homedir()).join('[home]')
    .replace(/"[^"\r\n]{1,2000}"|'[^'\r\n]{1,2000}'/g, '[quoted value]')
    .slice(0, 6000);
}

export class Diagnostics {
  readonly directory: string;
  private count = 0;
  private since = 0;
  constructor(directory: string, private readonly version: string, private readonly maxBytes = 1024 * 1024) {
    this.directory = join(directory, 'logs');
  }
  record(source: string, error: unknown) {
    // Logging must not throw, create a growing queue, or turn repeated failures into disk exhaustion.
    try {
      const now = Date.now();
      if (now - this.since >= 60_000) { this.since = now; this.count = 0; }
      if (++this.count > 120) return;
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
      const stack = error instanceof Error ? error.stack?.split('\n').filter(line => /^\s*at\s/.test(line)).slice(0, 12).join('\n') : undefined;
      const line = JSON.stringify({ time: new Date(now).toISOString(), version: this.version, platform: process.platform,
        source: source.replace(/[^\w:.-]/g, '').slice(0, 80), message: diagnosticText(message),
        ...(stack ? { stack: diagnosticText(stack) } : {}) }) + '\n';
      mkdirSync(this.directory, { recursive: true });
      const file = join(this.directory, 'runtime.jsonl');
      let bytes = 0; try { bytes = statSync(file).size; } catch {}
      if (bytes + Buffer.byteLength(line) > this.maxBytes) {
        rmSync(file + '.3', { force: true });
        for (let i = 2; i >= 0; i--) {
          try { renameSync(i ? file + '.' + i : file, file + '.' + (i + 1)); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
      }
      appendFileSync(file, line, { mode: 0o600 });
    } catch { /* An unwritable log directory must not break the original operation. */ }
  }
}
