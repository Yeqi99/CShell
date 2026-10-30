import { isPro } from '../shared/edition';
import { localMcpEndpoint } from '../shared/mcp-endpoint';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { addAbortSignal } from 'node:stream';
import { localApiTransport, runConsoleCommand } from '../core/command-client';
import { parseConsoleCommand } from '../shared/command-console';

export async function runCli(argv: string[], output = process.stdout, errors = process.stderr) {
  const abort = new AbortController();
  const cancel = () => abort.abort(); process.once('SIGINT', cancel);
  try {
    let endpoint = process.env.CSHELL_API_URL || localMcpEndpoint(), tokenFile = '', sessionId: string | undefined;
    let json = '', stdin = false, destination = '';
    const words: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '--stdin') { stdin = true; continue; }
      if (['--endpoint', '--token-file', '--session', '--json', '--out'].includes(arg)) {
        const value = argv[++i]; if (!value) throw Error(`${arg} 缺少值`);
        if (arg === '--endpoint') endpoint = value;
        if (arg === '--token-file') tokenFile = value;
        if (arg === '--session') sessionId = value;
        if (arg === '--json') json = value;
        if (arg === '--out') destination = value;
      } else if (arg.startsWith('--') && arg !== '--help') throw Error(`未知选项：${arg}`);
      else words.push(arg);
    }
    if (sessionId && !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(sessionId)) throw Error('--session 应为 connect 返回的会话 ID');
    if (stdin) {
      if (json || process.stdin.isTTY) throw Error('请通过标准输入传入 JSON，不与 --json 混用');
      process.stdin.setEncoding('utf8');
      for await (const chunk of addAbortSignal(abort.signal, process.stdin)) { json += chunk; if (Buffer.byteLength(json) > 60000) throw Error('输入超过 60 KiB'); }
    }
    const text = `${words.join(' ') || 'help'}${json ? ' ' + json : ''}`;
    const parsed = parseConsoleCommand(text);
    if (tokenFile && (await stat(tokenFile)).size > 8192) throw Error('访问令牌文件过大');
    const token = tokenFile ? (await readFile(tokenFile, 'utf8')).trim() : process.env.CSHELL_API_TOKEN || '';
    const transport = parsed.type === 'help' || parsed.type === 'context' ? async () => undefined : localApiTransport(endpoint, token, isPro ? 'pro' : 'opensource');
    const result = await runConsoleCommand(text, transport, sessionId, AbortSignal.any([abort.signal, AbortSignal.timeout(300000)]));
    if (destination) {
      const image = findImage(result.value);
      if (/\.(jpe?g|png)$/i.test(destination)) {
        if (!image) throw Error('本次结果没有可保存的图片');
        const bytes = Buffer.from(image.dataBase64, 'base64');
        if (bytes.length > 2 * 1024 * 1024 || bytes.toString('base64') !== image.dataBase64) throw Error('图片内容无效');
        if ((/\.png$/i.test(destination)) !== (image.mimeType === 'image/png')) throw Error('文件后缀与返回的图像格式不一致');
        await writeFile(destination, bytes, { flag: 'wx' });
      } else await writeFile(destination, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
      output.write(JSON.stringify({ saved: destination }) + '\n');
    } else output.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  } catch (e) {
    errors.write(JSON.stringify({ error: (e as Error).message, retry: '不会自动重试；写操作结果未知时先检查目标' }) + '\n');
    return abort.signal.aborted ? 130 : 1;
  } finally { process.removeListener('SIGINT', cancel); }
}
function findImage(value: unknown, depth = 0): { dataBase64: string; mimeType: string } | undefined {
  if (depth > 5 || !value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if ((v.mimeType === 'image/jpeg' || v.mimeType === 'image/png') && typeof v.dataBase64 === 'string') return v as { dataBase64: string; mimeType: string };
  for (const child of Object.values(v)) { const image = findImage(child, depth + 1); if (image) return image; }
}
