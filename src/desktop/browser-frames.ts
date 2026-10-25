import type { WebContents } from 'electron';
type Frame = { id: string; parentId?: string; name: string; url: string; session?: string };
const attached = new WeakMap<WebContents, { sessions: Set<string> }>();
async function debuggerFor(contents: WebContents) {
  let state = attached.get(contents);
  if (state && contents.debugger.isAttached()) return state;
  if (contents.debugger.isAttached()) throw Error('此页面正在由其他调试器控制，请结束调试后重试');
  contents.debugger.attach('1.3');
  state = { sessions: new Set() };
  attached.set(contents, state);
  const sessionState = state;
  const onMessage = (_event: Electron.Event, method: string, params: any) => {
    if (
      method === 'Target.attachedToTarget' &&
      params.targetInfo?.type === 'iframe' &&
      sessionState.sessions.size < 64
    ) {
      sessionState.sessions.add(params.sessionId);
      void contents.debugger
        .sendCommand(
          'Target.setAutoAttach',
          { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
          params.sessionId,
        )
        .catch(() => {});
    }
    if (method === 'Target.detachedFromTarget') sessionState.sessions.delete(params.sessionId);
  };
  contents.debugger.on('message', onMessage);
  contents.debugger.once('detach', () => {
    contents.debugger.removeListener('message', onMessage);
    attached.delete(contents);
  });
  await contents.debugger.sendCommand('Page.enable');
  await contents.debugger.sendCommand('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  return state;
}
export async function browserFrames(contents: WebContents) {
  const state = await debuggerFor(contents),
    frames = new Map<string, Frame>();
  const visit = (node: any, session?: string) => {
    if (frames.size >= 64) return;
    const frame = node.frame;
    frames.set(frame.id, {
      id: frame.id,
      parentId: frame.parentId,
      name: String(frame.name || '').slice(0, 300),
      url: String(frame.url || '').slice(0, 8192),
      session,
    });
    for (const child of node.childFrames ?? []) visit(child, session);
  };
  visit((await contents.debugger.sendCommand('Page.getFrameTree')).frameTree);
  for (const session of state.sessions) {
    try {
      visit(
        (await contents.debugger.sendCommand('Page.getFrameTree', {}, session)).frameTree,
        session,
      );
    } catch {
      /* A detached child is omitted, never rerouted to its parent. */
    }
  }
  return [...frames.values()];
}
/** Backend-only fixed source; frame IDs must belong to the current tab's actual tree. */
export async function isolatedFrameOperation(
  contents: WebContents,
  frameId: string,
  source: string,
  guard?: () => void,
) {
  const frame = (await browserFrames(contents)).find((frame) => frame.id === frameId);
  if (!frame) throw Error('页面框架已变化，请重新读取 browser_frames');
  const { executionContextId } = await contents.debugger.sendCommand(
    'Page.createIsolatedWorld',
    { frameId: frame.id, worldName: 'cshell-browser-tools', grantUniveralAccess: false },
    frame.session,
  );
  guard?.();
  const result = await contents.debugger.sendCommand(
    'Runtime.evaluate',
    {
      expression: source,
      contextId: executionContextId,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    },
    frame.session,
  );
  if (result.exceptionDetails) throw Error('框架操作失败，请重新读取该框架快照');
  return result.result?.value;
}
