import type { ClientDevice } from '../../shared/client';
import type { Store } from '../store';

/** Keep public sidebar metadata separate from the encrypted Client identity vault. */
export async function syncClientProfiles(store: Store, devices: ClientDevice[]) {
  for (const device of devices) {
    const existing = store.snapshot().profiles.find((p) => p.id === device.deviceId);
    if (existing && existing.protocol !== 'client') throw new Error('Connection identity conflict');
    if (existing && existing.host === device.host && existing.port === device.port) continue;
    await store.saveProfile({
      id: device.deviceId,
      name: device.name,
      username: 'Client',
      group: '',
      favorite: false,
      auth: 'password',
      clientShell: 'powershell',
      ...existing,
      protocol: 'client',
      host: device.host,
      port: device.port,
    });
  }
}
