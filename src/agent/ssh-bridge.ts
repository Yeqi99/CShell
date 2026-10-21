import { callAgent } from './control';
import { agentCallSchema } from '../shared/agent';
import { linuxWorkspaceMethods } from '../shared/linux-workspace';
import { z } from 'zod';

/** Only entered by the authenticated SSH user's explicit cagent bridge command.
 * No network listener or credentials are exported over this stream. */
export function startSshBridge() {
  let buffer = '',
    pending = 0;
  process.stdin.setEncoding('utf8');
  const write = (value: unknown) => {
    const line = JSON.stringify(value);
    if (Buffer.byteLength(line) > 2 * 1024 * 1024) throw new Error('响应过大');
    process.stdout.write(line + '\n');
  };
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 1048576) {
      process.stdin.destroy();
      process.exitCode = 1;
      return;
    }
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      let id = '';
      try {
        const raw = JSON.parse(line);
        id = z.string().uuid().parse(raw.id);
        const call = agentCallSchema.parse(raw.call);
        if (!linuxWorkspaceMethods.has(call.method) || pending >= 8)
          throw new Error('操作未开放或通道繁忙');
        pending++;
        void callAgent(call.method, call.params)
          .then((result) => write({ id, result }))
          .catch((error) => write({ id, error: String(error.message).slice(0, 500) }))
          .finally(() => pending--);
      } catch (error) {
        write({ id, error: (error as Error).message.slice(0, 500) });
      }
    }
  });
}
