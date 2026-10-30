import { request } from 'node:http';
import { commandHelp, parseConsoleCommand, type CapabilityContract, type CommandResult } from '../shared/command-console';

export type CommandTransport = (path: 'capabilities' | 'invoke', data: unknown, signal?: AbortSignal) => Promise<any>;
export function localApiTransport(base: string, token: string, expectedEdition?: 'pro'|'opensource'): CommandTransport {
  const url = new URL(base);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname))
    throw Error('CShell CLI 只连接本机 API 地址，例如 http://127.0.0.1:3777');
  if (!token || /[\r\n]/.test(token)) throw Error('请先在 API 设置中获取访问令牌');
  const send:CommandTransport = (path, data, signal) => new Promise((ok, fail) => {
    const body = JSON.stringify(data);
    if (Buffer.byteLength(body) > 65536) { fail(Error('命令参数超过 64 KiB')); return; }
    const req = request(new URL(`/api/v1/${path}`, url), { method: 'POST', signal,
      headers: { ...(expectedEdition ? {'X-CShell-Edition':expectedEdition}:{}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let bytes = 0; const chunks: Buffer[] = [];
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 16 * 1024 * 1024) { res.destroy(); fail(Error('响应过大，请缩小读取范围')); return; }
        chunks.push(chunk);
      });
      res.on('error', fail);
      res.on('end', () => {
        try {
          if (expectedEdition && res.headers['x-cshell-edition'] !== expectedEdition) throw Error('CShell edition mismatch or service identity unavailable. Check the endpoint in the intended application; no further command will be sent.');
          if (res.statusCode === 401) throw Error('API 访问令牌失效，请检查当前应用的 API 设置');
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (value.error) throw Error(`${value.error.code || 'ERROR'}: ${value.error.message || '调用未完成'}${value.error.nextAction ? '\n' + value.error.nextAction : ''}`);
          if (!res.statusCode || res.statusCode >= 400 || value.apiVersion !== '1') throw Error('CShell API 返回无效响应');
          ok(value.result);
        } catch (e) { fail(e); }
      });
    });
    req.on('error', e => fail(signal?.aborted ? Error('已停止等待；写入操作的结果可能未知，请先检查目标状态') : e));
    req.end(body);
  });
  return async(path,data,signal)=>{if(expectedEdition && path === 'invoke') await send('capabilities',{level:'summary',limit:1},signal);return send(path,data,signal);};
}
export async function runConsoleCommand(text: string, transport: CommandTransport, sessionId?: string, signal?: AbortSignal): Promise<CommandResult> {
  const parsed = parseConsoleCommand(text);
  if (parsed.type === 'help') return { kind: 'help', title: 'CShell 命令', value: commandHelp };
  if (parsed.type === 'context') return { kind: 'context', title: parsed.sessionId ? '已选择机器会话' : '已返回应用范围', value: {}, sessionId: parsed.sessionId };
  if (parsed.type === 'catalog') {
    const items: CapabilityContract[] = []; let cursor: string | undefined;
    for (let page = 0; page < 128; page++) {
      signal?.throwIfAborted();
      const result = await transport('capabilities', { level: parsed.capabilityId ? 'guide' : 'summary', query: parsed.query,
        ...(parsed.capabilityId ? { capabilityId: parsed.capabilityId } : {}), ...(sessionId ? { sessionId } : {}),
        ...(cursor ? { cursor } : {}), limit: 100, budgetBytes: 262144 }, signal);
      if (!Array.isArray(result.items)) throw Error('能力目录格式无效');
      items.push(...result.items); if (items.length > 4096) throw Error('能力目录超过限制，请使用关键词查询');
      if (!result.nextCursor) return { kind: 'catalog', title: parsed.capabilityId || '可用能力', value: items };
      if (result.nextCursor === cursor) throw Error('能力目录游标重复');
      cursor = result.nextCursor;
    }
    throw Error('能力目录页数超过限制，请使用关键词查询');
  }
  const body = sessionId && !parsed.application
    ? { name: 'invoke_connection', arguments: { sessionId, tool: parsed.name, arguments: parsed.arguments } }
    : { name: parsed.name, arguments: parsed.arguments };
  return { kind: 'result', title: parsed.name, value: await transport('invoke', body, signal) };
}
