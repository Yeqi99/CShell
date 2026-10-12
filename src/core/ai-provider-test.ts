import { readAiResponse } from './ai-response';

/** A real, isolated completion probe. No conversation, tools, or user context is sent. */
export async function testAiProvider(p: { url: string; model: string; key: string }) {
  const started = Date.now();
  let firstTokenMs: number | null = null;
  const base = p.url.replace(/\/+$/, '');
  try {
    const response = await fetch(
      base + (base.endsWith('/chat/completions') ? '' : '/chat/completions'),
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
        headers: {
          'Content-Type': 'application/json',
          ...(p.key ? { Authorization: `Bearer ${p.key}` } : {}),
        },
        body: JSON.stringify({
          model: p.model,
          stream: true,
          messages: [{ role: 'user', content: 'Reply with OK only.' }],
        }),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      const reason =
        response.status === 401 || response.status === 403
          ? '请检查 API Key 与访问权限'
          : response.status === 404
            ? '请检查 API URL 与模型 ID'
            : response.status === 429
              ? '请求受限或额度不足'
              : '服务返回错误';
      throw new Error(`HTTP ${response.status} · ${reason}`);
    }
    const streaming = !!response.headers.get('content-type')?.includes('text/event-stream');
    const reply = await readAiResponse(response, (text) => {
      if (text && firstTokenMs === null) firstTokenMs = Date.now() - started;
    });
    if (!reply.content?.trim() || reply.tool_calls?.length) throw new Error('模型未返回有效文本');
    return { elapsedMs: Date.now() - started, firstTokenMs, streaming };
  } catch (e) {
    if ((e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError')
      throw new Error('连接超时，请检查网络或代理设置');
    if (e instanceof TypeError) throw new Error('无法连接，请检查 API URL、网络或代理设置');
    throw e;
  }
}
