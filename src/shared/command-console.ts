export type CapabilityContract = {
  id: string; name: string; description: string; permission: string; target: string;
  effects: 'read' | 'write'; inputSchema?: Record<string, any>;
  examples?: { input: Record<string, unknown>; explanation: string }[];
};
export type CommandRequest = { id: string; text: string; sessionId?: string };
export type CommandResult = { title: string; kind: 'help' | 'catalog' | 'result' | 'context'; value: unknown; sessionId?: string };
export interface CommandBridge {
  commandStatus(): Promise<{ enabled: boolean; running: boolean; error?: string }>;
  commandRun(input: CommandRequest): Promise<CommandResult>;
  commandCancel(id: string): Promise<void>;
}
export const commandHelp = {
  description: 'CShell 命令台，调用应用能力；不会把输入当作 CMD、PowerShell 或远端 Shell。',
  commands: [
    ['tools [关键词]', '列出当前已授权能力，扩展启用后自动出现'],
    ['help <能力名>', '查看完整参数、权限与示例'],
    ['servers', '列出已授权的保存连接'],
    ['connect <连接ID>', '打开独立 API 连接，不接管已有终端'],
    ['use <会话ID> / use app', '选择机器会话或返回应用范围'],
    ['call <能力名> {JSON参数}', '调用当前范围中的能力'],
    ['api <能力名> {JSON参数}', '直接调用应用范围的能力'],
    ['disconnect <会话ID>', '关闭自己的 API 连接'],
    ['clear', '清空当前命令台显示，不停止远端任务'],
  ],
  examples: ['servers', 'connect <连接ID>', 'use <返回的sessionId>', 'tools browser', 'help browser_snapshot'],
};
export type ParsedCommand =
  | { type: 'help' }
  | { type: 'catalog'; query: string; capabilityId?: string }
  | { type: 'context'; sessionId?: string }
  | { type: 'invoke'; name: string; arguments: Record<string, unknown>; application: boolean };
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export function parseConsoleCommand(text: string): ParsedCommand {
  if (typeof text !== 'string' || text.length > 60000 || /[\0]/.test(text)) throw Error('命令为空、过长或包含无效字符');
  const source = text.trim().replace(/^cshell\s+/, '');
  const word = /^(\S+)(?:\s+([\s\S]*))?$/.exec(source);
  if (!word) return { type: 'help' };
  const [, name, rest = ''] = word;
  if ((name === 'help' || name === '--help') && !rest) return { type: 'help' };
  if (name === 'tools' || name === 'help' || name === 'describe') {
    if (rest.length > 200) throw Error('查询过长');
    return { type: 'catalog', query: name === 'tools' ? rest : '', ...(name !== 'tools' ? { capabilityId: rest } : {}) };
  }
  if (name === 'use') {
    if (rest === 'app') return { type: 'context' };
    if (!uuid.test(rest)) throw Error('use 后填写 connect 返回的会话 ID，或 app');
    return { type: 'context', sessionId: rest };
  }
  if (name === 'servers' && !rest) return { type: 'invoke', name: 'list_servers', arguments: {}, application: true };
  if (name === 'connect' || name === 'disconnect') {
    if (!uuid.test(rest)) throw Error(`${name} 后填写${name === 'connect' ? '连接' : '会话'} ID`);
    return { type: 'invoke', name, arguments: { [name === 'connect' ? 'profileId' : 'sessionId']: rest }, application: true };
  }
  const explicit = name === 'call' || name === 'api';
  const match = explicit ? /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest) : [source, name, rest];
  if (!match || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/.test(match[1])) throw Error('请输入能力名称，使用 tools 查看可用命令');
  let args: unknown;
  try { args = JSON.parse(match[2] || '{}'); } catch { throw Error('参数应为完整 JSON 对象；命令台不执行 Shell 表达式'); }
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('参数必须是 JSON 对象');
  return { type: 'invoke', name: match[1], arguments: args as Record<string, unknown>, application: name === 'api' };
}
// Do not echo or persist command arguments: they can contain login credentials.
export function commandLabel(text: string) {
  try { const p = parseConsoleCommand(text); return p.type === 'invoke' ? p.name : p.type === 'catalog' ? (p.capabilityId ? `help ${p.capabilityId}` : 'tools') : p.type === 'context' ? 'use' : 'help'; }
  catch { return '命令'; }
}
