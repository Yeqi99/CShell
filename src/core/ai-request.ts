import { setTimeout as wait } from 'node:timers/promises';
import { fetchAiProtocol } from './ai-protocol';
import { readAiResponse } from './ai-response';

function transientTransportFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  const {code, cause} = error as Error & {code?:string; cause?:{code?:string}};
  return /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/.test(cause?.code ?? code ?? '')
    || /^(fetch failed|net::ERR_(TIMED_OUT|CONNECTION_TIMED_OUT|CONNECTION_RESET|CONNECTION_CLOSED|HTTP2_PROTOCOL_ERROR|PROXY_CONNECTION_FAILED))$/.test(error.message);
}

// Keep active reasoning/tool streams alive, but bound silent and endless responses.
export async function requestAiReply(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  onContent: (content: string) => void,
  limits = { idleMs: 180_000, totalMs: 600_000 },
  transport:typeof fetch=fetch,
  onUsage?: import('./ai-response').UsageCallback,
  onRetry?: (attempt: number) => void,
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
    const fetchResponse = () => fetchAiProtocol(transport, url, { ...init, signal: combined });
    let response: Response;
    let publishedText = false;
    for (let attempt = 0; ; attempt++) {
      combined.throwIfAborted();
      try {
        response = await fetchResponse();
        if (response.ok) {
          onRetry?.(0);
          return await readAiResponse(response, content => {
            publishedText ||= content.length > 0;
            onContent(content);
          }, activity, onUsage);
        }
        if (attempt >= 2 || ![502, 503, 504].includes(response.status)) break;
        await response.body?.cancel();
      } catch (error) {
        const streamEnded = error instanceof Error && /^(AI 响应中断|Responses 连接中断)/.test(error.message);
        if (attempt >= 2 || combined.aborted || publishedText || !(streamEnded || transientTransportFailure(error))) throw error;
      }
      // Repeat this model request on its original route. Tool execution is outside this loop.
      onRetry?.(attempt + 1);
      await wait(500 * 2 ** attempt, undefined, {signal: combined});
    }
    onRetry?.(0);
      await response.body?.cancel();
      if([400,413,415,422].includes(response.status)&&typeof init.body==='string'&&init.body.includes('"image_url"'))throw Error(`当前模型服务未接受图片输入（HTTP ${response.status}）。图片能力或大小可能不受支持；可改用 browser_snapshot 读取页面，或切换明确支持图片的模型。工具操作没有重放。`);
      const hint = response.status===401 ? '模型服务未接受当前凭据。请在模型基座中更新 API Key，或重新登录该模型服务。'
        :response.status===403 ? '当前账号无权使用此模型，请检查基座权限'
        :response.status===429 ? '模型请求较多或额度已用完，请稍后重试或切换模型'
        :response.status===400||response.status===413||response.status===422 ? '模型未接受本次输入，请缩短会话或切换兼容的模型'
        :response.status>=500 ? '模型服务暂时无法响应，请稍后重试或切换模型'
        :'模型请求失败，请检查基座连接';
      throw new Error(`${hint}（AI API HTTP ${response.status}）`);
  } catch (error) {
    if (combined.aborted) throw combined.reason;
    const code=(error as {cause?:{code?:string};code?:string})?.cause?.code ?? (error as {code?:string})?.code;
    if (transientTransportFailure(error) || (error instanceof TypeError && error.message==='fetch failed') || /^(?:ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR_CONNECT)/.test(code ?? ''))
      throw new Error('无法连接模型服务，请检查所选网络出口或系统代理。账号与密钥已保留；请求没有自动改用直连。');
    throw error;
  } finally {
    clearTimeout(idle);
    clearTimeout(total);
  }
}
