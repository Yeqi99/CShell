import type { ParsedMarkdown } from './markdown-document';

// One worker per window. Keep only the newest pending revision of each mounted message.
declare const __ANDROID_MARKDOWN_WORKER__: string | undefined;
type Job = { text: string; accept: (tree: ParsedMarkdown) => void };
const pending = new Map<object, Job>();
let worker: Worker | undefined;
let running: { key: object; job: Job; id: number } | undefined;
let sequence = 0;
function pump() {
  if (running || !pending.size) return;
  const [key, job] = pending.entries().next().value!;
  pending.delete(key);
  const id = ++sequence;
  running = { key, job, id };
  if (!worker) {
    try {
      worker = typeof __ANDROID_MARKDOWN_WORKER__ === 'string'
        ? new Worker(__ANDROID_MARKDOWN_WORKER__)
        : new Worker(new URL('./markdown-worker.ts', import.meta.url), { type: 'module' });
    } catch {
      running = undefined;
      job.accept(null);
      pump();
      return;
    }
    worker.onmessage = ({data}) => {
      if (!running || data.id !== running.id) return;
      const finished = running;
      running = undefined;
      finished.job.accept(data.tree);
      pump();
    };
    worker.onerror = () => {
      const failed = running;
      worker?.terminate();
      worker = undefined;
      running = undefined;
      failed?.job.accept(null);
      pump();
    };
  }
  worker.postMessage({ id, text: job.text });
}
export function scheduleMarkdown(key: object, job: Job) {
  pending.set(key, job);
  pump();
  return () => { if (pending.get(key) === job) pending.delete(key); };
}
