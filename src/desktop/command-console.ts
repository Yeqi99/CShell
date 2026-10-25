import { z } from 'zod';
import type { McpService } from '../core/mcp';
import { localApiTransport, runConsoleCommand } from '../core/command-client';
import { parseConsoleCommand } from '../shared/command-console';

export function registerCommandConsole(handle: (name: string, fn: (...args: any[]) => any) => void, service: () => McpService) {
  const pending = new Map<string, AbortController>();
  handle('command:status', () => { const status = service().status(); return { enabled: status.settings.enabled, running: status.running, error: status.error }; });
  handle('command:run', async (input: unknown) => {
    const value = z.object({ id: z.string().uuid(), text: z.string().max(60000), sessionId: z.string().uuid().optional() }).strict().parse(input);
    if (pending.has(value.id) || pending.size >= 8) throw Error('命令台正在处理其他请求');
    const parsed = parseConsoleCommand(value.text);
    const noApi = parsed.type === 'help' || parsed.type === 'context';
    const mcp = service(), status = mcp.status();
    if (!noApi && (!status.running || !status.settings.enabled)) throw Error('API 尚未启用或无法启动，请在设置 → AI 与安全 → API / MCP 中检查');
    const controller = new AbortController(); pending.set(value.id, controller);
    try {
      const transport = noApi ? async () => { throw Error('此命令不访问 API'); }
        : localApiTransport(`http://127.0.0.1:${status.settings.port}`, await mcp.accessToken());
      return await runConsoleCommand(value.text, transport, value.sessionId, AbortSignal.any([controller.signal, AbortSignal.timeout(300000)]));
    } finally { pending.delete(value.id); }
  });
  handle('command:cancel', (id: unknown) => { pending.get(z.string().uuid().parse(id))?.abort(); });
  return () => { for (const controller of pending.values()) controller.abort(); pending.clear(); };
}
