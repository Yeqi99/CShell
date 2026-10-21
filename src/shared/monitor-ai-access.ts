import type { ViewTile } from './monitor-views';

/** View windows can use explicitly selected conversations and their own terminal analyses only. */
export function monitorOwnsAi(tiles: readonly ViewTile[], created: ReadonlySet<string> | undefined, id: unknown) {
  return typeof id === 'string' && (tiles.some(t => t.kind === 'ai' && t.threadId === id) || created?.has(id) === true);
}
export function assertMonitorAiRequest(channel: string, args: unknown[], tiles: readonly ViewTile[], created: ReadonlySet<string> | undefined, sessions: ReadonlyMap<string, unknown>) {
  if (channel === 'ai:create' && (args[0] !== 'terminal' || typeof args[3] !== 'string' || !sessions.has(args[3]))) throw new Error('AI 分析必须绑定此视图中的有效终端');
  if (['ai:send', 'ai:stop', 'ai:approve', 'ai:mode'].includes(channel) && !monitorOwnsAi(tiles, created, args[0])) throw new Error('智能体会话不属于此视图');
}
