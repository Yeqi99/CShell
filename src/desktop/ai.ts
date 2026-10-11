import { AiService } from '../core/ai';
import type { Store } from '../core/store';
import type { SshService } from '../core/ssh';
export async function registerAiHandlers(
  handle: (name: string, fn: (...args: any[]) => any) => void,
  directory: string,
  store: Store,
  ssh: SshService,
) {
  const ai = new AiService(directory, store, ssh);
  await ai.load();
  handle('ai:snapshot', () => ai.snapshot());
  handle('ai:provider-save', (p, key) => ai.saveProvider(p, key));
  handle('ai:provider-delete', (id) => ai.deleteProvider(id));
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
