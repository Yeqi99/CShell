import { readAiResponse } from './ai-response';

// Keep active reasoning/tool streams alive, but bound silent and endless responses.
export async function requestAiReply(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  onContent: (content: string) => void,
  limits = { idleMs: 180_000, totalMs: 600_000 },
  transport:typeof fetch=fetch,
) {
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  let received = false;
  const timeout = (total: boolean) => controller.abort(new Error(total
    ? '模型本轮响应超过 10 分钟，已停止等待。已完成的工具操作不会自动重试。'
    : received
      ? '模型响应中断：连续 3 分钟没有收到数据。请检查基座连接后继续；已完成的工具操作不会自动重试。'
      : '模型基座连续 3 分钟未返回数据。请检查基座服务或切换模型后重试。'));
  let idle = setTimeout(() => timeout(false), limits.idleMs);
  const total = setTimeout(() => timeout(true), limits.totalMs);
  const activity = () => {
    received = true;
    clearTimeout(idle);
    idle = setTimeout(() => timeout(false), limits.idleMs);
  };
  try {
    const response = await transport(url, { ...init, signal: combined });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`AI API HTTP ${response.status}`);
    }
    return await readAiResponse(response, onContent, activity);
  } catch (error) {
    if (combined.aborted) throw combined.reason;
    throw error;
  } finally {
    clearTimeout(idle);
    clearTimeout(total);
  }
}
