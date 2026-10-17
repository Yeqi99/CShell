import { z } from 'zod';
const callSchema = z.object({
  id: z.string().max(200),
  type: z.literal('function'),
  function: z.object({ name: z.string().max(80), arguments: z.string().max(32000) }),
});
const replySchema = z.object({
  content: z.string().nullish(),
  tool_calls: z.array(callSchema).max(16).nullish(),
});
export const pseudoToolCall = (text: string) => /<tool_call\b|<function\s*=/i.test(text);
// Only explicit short progress announcements get one continuation, never arbitrary answers.
export const progressOnly = (text: string) =>
  text.length < 320 &&
  /^(先|我先|我会|接下来我|让我|I'll |I will |Let me )/.test(text.trim()) &&
  !/[?？]/.test(text);
function checkFinish(reason: unknown) {
  if (reason === 'length')
    throw new Error('模型输出达到长度上限，本轮未完成；请继续或调整基座输出限制。');
  if (reason === 'content_filter') throw new Error('基座过滤了响应，本轮未完成。');
}
export async function readAiResponse(response: Response, onContent: (content: string) => void) {
  if (!response.body) throw new Error('AI 返回了空响应');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  const streaming = response.headers.get('content-type')?.includes('text/event-stream');
  let raw = '',
    pending = '',
    content = '',
    size = 0,
    finished = false;
  const calls = new Map<number, any>();
  const event = (block: string) => {
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    if (data.trim() === '[DONE]') {
      finished = true;
      return;
    }
    const value = JSON.parse(data);
    if (value.error) throw new Error('AI 流式响应出错，请重试');
    const choice = value.choices?.find((c: any) => c.index === 0) ?? value.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) {
      checkFinish(choice.finish_reason);
      finished = true;
    }
    const delta = choice.delta ?? {};
    if (typeof delta.content === 'string') {
      content += delta.content;
      onContent(content);
    }
    if (delta.tool_calls != null) {
      if (!Array.isArray(delta.tool_calls)) throw new Error('AI 工具调用格式无效');
      for (const part of delta.tool_calls) {
        if (!Number.isInteger(part.index) || part.index < 0 || part.index >= 16)
          throw new Error('AI 工具调用索引无效');
        const c = calls.get(part.index) ?? {
          id: '',
          type: 'function',
          function: { name: '', arguments: '' },
        };
        if (part.id) c.id += part.id;
        if (part.type) c.type = part.type;
        if (part.function?.name) c.function.name += part.function.name;
        if (part.function?.arguments) c.function.arguments += part.function.arguments;
        calls.set(part.index, c);
      }
    }
  };
  try {
    while (true) {
      const chunk = await reader.read();
      const text = decoder.decode(chunk.value, { stream: !chunk.done });
      size += text.length;
      if (size > 2_000_000) throw new Error('AI response too large');
      if (streaming) {
        pending += text;
        let match;
        while ((match = /\r?\n\r?\n/.exec(pending))) {
          event(pending.slice(0, match.index).replace(/\r\n/g, '\n'));
          pending = pending.slice(match.index + match[0].length);
        }
      } else raw += text;
      if (chunk.done) break;
    }
    if (!streaming) {
      const value = JSON.parse(raw);
      checkFinish(value.choices?.[0]?.finish_reason);
      const parsed = z
        .object({ choices: z.array(z.object({ message: replySchema })).min(1) })
        .parse(value);
      return parsed.choices[0].message;
    }
    if (pending.trim()) event(pending.replace(/\r\n/g, '\n'));
    if (!finished) throw new Error('AI 响应中断，请重试；未执行未完成的工具调用。');
    return replySchema.parse({
      content,
      tool_calls: [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c),
    });
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
