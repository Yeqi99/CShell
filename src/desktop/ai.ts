import { AiService, type AiConnectionHost } from '../core/ai';
import type { Store } from '../core/store';
import type { AiThread } from '../shared/ai';

import type { ConnectionRegistry } from '../core/connections/registry';
export async function registerAiHandlers(
  handle: (name: string, fn: (...args: any[]) => any) => void,
  directory: string,
  store: Store,
  connections: ConnectionRegistry,
  connectHost?: AiConnectionHost,
  publish?: (channel: string, value?: unknown) => void,
) {
  const ai = new AiService(directory, store, connections, connectHost);
  const pending = new Map<string, AiThread>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  ai.onThreadUpdate = (thread) => {
    pending.set(thread.id, thread);
    timer ??= setTimeout(() => {
      timer = undefined;
      pending.forEach((t) => publish?.('ai:thread', t));
      pending.clear();
    }, 40);
  };
  await ai.load();
  handle('ai:text', (input) => ai.text(input));
  handle('ai:text-provider', (kind, id) => ai.setTextProvider(kind, id));
  handle('ai:policy', (p) => ai.savePolicy(p));
  handle('ai:extraction-provider', async (id) => {
    await ai.setExtractionProvider(id);
    publish?.('ai:providers-changed');
  });
  handle('ai:snapshot', () => ai.snapshot());
  handle('ai:extract-connection', (text, provider) => ai.extractConnection(text, provider));
  handle('ai:provider-test', (p, key) => ai.testProvider(p, key));
  handle('ai:provider-save', async (p, key) => {
    await ai.saveProvider(p, key);
    publish?.('ai:providers-changed');
  });
  handle('ai:provider-delete', async (id) => {
    await ai.deleteProvider(id);
    publish?.('ai:providers-changed');
  });
  handle('ai:permission', (p) => ai.permission(p));
  handle('ai:create', (location, provider, mode, session) =>
    ai.create(location, provider, mode, session),
  );
  handle('ai:delete', (id) => ai.remove(id));
  handle('ai:send', (id, text) => ai.send(id, text));
  handle('ai:approve', (id, request, allow) => ai.approve(id, request, allow));
  handle('ai:stop', (id) => ai.stop(id));
  handle('ai:mode', (id, mode) => ai.mode(id, mode));
}
