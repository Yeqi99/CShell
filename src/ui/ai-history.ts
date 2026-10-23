import type { AiThread } from '../shared/ai';

export function conversationHistory(threads: AiThread[], search: string) {
  const query = search.trim().toLocaleLowerCase();
  const active = (t: AiThread) => t.state === 'running' || t.state === 'approval';
  const time = (t: AiThread) => t.messages.at(-1)?.time ?? 0;
  return threads.filter(t => `${t.title} ${t.target ?? ''}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => Number(active(b)) - Number(active(a)) || time(b) - time(a));
}

export function conversationStatus(thread: AiThread) {
  if (thread.state === 'running') return '正在执行';
  if (thread.state === 'approval') return '等待审核';
  if (thread.checkpoint?.recoveryRequired) return '待恢复 · 先核查结果';
  if (thread.state === 'error') return '未完成';
  return '已结束';
}
