import { AgentLanService } from '../core/agent-lan';
import { lanRegistrationSchema, type LanRegistration } from '../shared/agent-lan';
import type { ClientVault } from '../core/client/identity';
import type { ClientStatus } from '../shared/client';
/** Start after ClientServer initialization; close with runtime. No password is read or announced. */
export async function createLanRegistration(options: { vault: ClientVault; status(): ClientStatus; version: string }) {
  const service = new AgentLanService();
  let config = await options.vault.read('lan-registration', lanRegistrationSchema);
  let stopped = false, updating = false;
  async function refresh() {
    if (stopped || updating) return;
    updating = true;
    try {
      const state = options.status();
      const available = config?.enabled && state.running && state.port && state.bind && !['127.0.0.1', '::1'].includes(state.bind);
      await service.setAdvertisement(available ? { protocol: 'cshell-agent-lan-1', deviceId: state.deviceId, fingerprint: state.fingerprint,
        name: config!.name, room: config!.room, port: state.port!, version: options.version } : null, available ? state.bind : undefined);
    } catch { /* Status carries a sanitized network failure; listener itself is unaffected. */ }
    finally { updating = false; }
  }
  await refresh();const timer = setInterval(() => void refresh(), 2500);timer.unref();
  return {
    status: () => ({ config: config ? { ...config } : null, ...service.status() }),
    async configure(value: LanRegistration) { config = lanRegistrationSchema.parse(value);await options.vault.write('lan-registration', config);await refresh();return this.status(); },
    async close() { stopped = true;clearInterval(timer);await service.dispose(); },
  };
}
