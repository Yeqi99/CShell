import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { activitySchema, type Activity, type ActivitySnapshot } from '../shared/activity';
const schema = z.object({
  enabled: z.boolean(),
  since: z.number(),
  events: z.array(activitySchema).max(50000),
});
export class ActivityStore {
  private state: ActivitySnapshot = { enabled: true, since: Date.now(), events: [] };
  private pending = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private damaged = false;
  private error = '';
  constructor(private directory: string) {}
  async load() {
    await mkdir(this.directory, { recursive: true });
    try {
      this.state = schema.parse(
        JSON.parse(await readFile(join(this.directory, 'activity.json'), 'utf8')),
      );
      this.prune();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.damaged = true;
        this.state.enabled = false;
        this.error = '统计记录无法读取，已暂停记录；原文件保留。';
      }
    }
  }
  private prune() {
    const cutoff = Date.now() - 366 * 86400000;
    this.state.events = this.state.events.filter((e) => e.time >= cutoff).slice(-50000);
  }
  record(input: Omit<Activity, 'id' | 'time'>) {
    if (!this.state.enabled) return;
    const event = activitySchema.parse({ ...input, id: randomUUID(), time: Date.now() });
    this.state.events.push(event);
    this.prune();
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush().catch(() => {});
      }, 500);
  }
  snapshot(): ActivitySnapshot {
    this.prune();
    return structuredClone({ ...this.state, ...(this.error ? { error: this.error } : {}) });
  }
  async enable(enabled: boolean) {
    this.state.enabled = z.boolean().parse(enabled);
    await this.flush();
  }
  async clear() {
    this.state.events = [];
    this.state.since = Date.now();
    await this.flush();
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const payload = JSON.stringify(this.state);
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        const temp = join(this.directory, 'activity.tmp');
        try {
          if (this.damaged) {
            await rename(
              join(this.directory, 'activity.json'),
              join(this.directory, 'activity.corrupt-' + Date.now() + '.json'),
            );
            this.damaged = false;
          }
          await writeFile(temp, payload, { mode: 0o600 });
          await rename(temp, join(this.directory, 'activity.json'));
          this.error = '';
        } catch (e) {
          this.error = '统计写入失败，请检查本机存储。';
          throw e;
        }
      });
    return this.pending;
  }
}
const escapeHtml = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function exportActivity(events: Activity[], format: 'csv' | 'html') {
  const rows = [
    ['Time', 'Type', 'Action', 'Status', 'Provider', 'Resource', 'Duration ms', 'Bytes'],
    ...events.map((e) => [
      new Date(e.time).toISOString(),
      e.kind,
      e.action,
      e.status,
      e.provider,
      e.resource || '',
      e.duration ?? '',
      e.bytes ?? '',
    ]),
  ];
  if (format === 'csv')
    return (
      '\uFEFF' +
      rows
        .map((r) =>
          r
            .map(
              (v) =>
                '"' +
                String(v)
                  .replace(/^\s*[=+@\-]/, "'$&")
                  .replace(/"/g, '""') +
                '"',
            )
            .join(','),
        )
        .join('\r\n')
    );
  return (
    '<!doctype html><meta charset="utf-8"><title>CShell activity</title><style>body{font:14px system-ui;margin:32px;color:#233248}table{border-collapse:collapse;width:100%}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}</style><h1>CShell · 本机操作记录</h1><table>' +
    rows
      .map(
        (r, i) =>
          '<tr>' +
          r.map((v) => `<${i ? 'td' : 'th'}>${escapeHtml(v)}</${i ? 'td' : 'th'}>`).join('') +
          '</tr>',
      )
      .join('') +
    '</table>'
  );
}
