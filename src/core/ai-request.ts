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
      if([400,413,415,422].includes(response.status)&&typeof init.body==='string'&&init.body.includes('"image_url"'))throw Error(`当前模型服务未接受图片输入（HTTP ${response.status}）。图片能力或大小可能不受支持；可改用 browser_snapshot 读取页面，或切换明确支持图片的模型。工具操作没有重放。`);
      const hint = response.status===401 ? '模型登录已失效，请重新登录或检查 API Key'
        :response.status===403 ? '当前账号无权使用此模型，请检查基座权限'
        :response.status===429 ? '模型请求较多或额度已用完，请稍后重试或切换模型'
        :response.status===400||response.status===413||response.status===422 ? '模型未接受本次输入，请缩短会话或切换兼容的模型'
        :response.status>=500 ? '模型服务暂时无法响应，请稍后重试或切换模型'
        :'模型请求失败，请检查基座连接';
      throw new Error(`${hint}（AI API HTTP ${response.status}）`);
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
