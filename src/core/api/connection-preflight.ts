import ssh2, { type ConnectConfig } from 'ssh2';
import { createHash } from 'node:crypto';
import type { Profile } from '../../shared/contracts';

type Stage = {
  checked: boolean;
  outcome:
    'not_checked' | 'ok' | 'untrusted' | 'changed' | 'missing_credentials' | 'failed' | 'timeout';
};
export type PreflightStages = {
  network: Stage;
  identity: Stage;
  authentication: Stage;
  authorization: Stage;
};
export const uncheckedStages = (): PreflightStages => ({
  network: { checked: false, outcome: 'not_checked' },
  identity: { checked: false, outcome: 'not_checked' },
  authentication: { checked: false, outcome: 'not_checked' },
  authorization: { checked: true, outcome: 'ok' },
});
/** Auth-only SSH handshake. Never opens a channel, accepts a new host pin, or retries. */
export async function preflightSsh(
  profile: Profile,
  expectedFingerprint: string | undefined,
  secret: Pick<ConnectConfig, 'password' | 'privateKey' | 'passphrase'> | undefined,
  guard: () => void,
  signal: AbortSignal,
  timeoutMs = 5000,
) {
  guard();
  signal.throwIfAborted();
  const stages = uncheckedStages();
  if (profile.jumpProfileId) return { stages, reason: 'jump_transport_not_supported' as const };
  if (!['ssh', 'sftp'].includes(profile.protocol ?? 'ssh'))
    return { stages, reason: 'provider_not_supported' as const };
  return new Promise<{ stages: PreflightStages; reason: string }>((resolve, reject) => {
    const client = new ssh2.Client();
    let done = false,
      reason = 'network_failed';
    const finish = (failure?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      client.destroy();
      if (failure) reject(failure);
      else resolve({ stages, reason });
    };
    const check = () => {
      try {
        guard();
        signal.throwIfAborted();
        return true;
      } catch (error) {
        finish(error);
        return false;
      }
    };
    const abort = () => finish(signal.reason ?? new Error('Cancelled'));
    const timer = setTimeout(
      () => {
        if (!check()) return;
        const stage = !stages.network.checked
          ? stages.network
          : !stages.identity.checked
            ? stages.identity
            : stages.authentication;
        stage.checked = true;
        stage.outcome = 'timeout';
        reason = 'timeout';
        finish();
      },
      Math.max(100, Math.min(10000, timeoutMs)),
    );
    signal.addEventListener('abort', abort, { once: true });
    client.once('connect', () => {
      if (check()) stages.network = { checked: true, outcome: 'ok' };
    });
    client.once('ready', () => {
      if (!check()) return;
      stages.authentication = { checked: true, outcome: 'ok' };
      reason = 'ready';
      finish();
    });
    client.on('error', (error: { level?: string }) => {
      if (done || !check()) return;
      if (error.level === 'client-authentication') {
        stages.authentication = { checked: true, outcome: 'failed' };
        reason = 'authentication_failed';
      } else if (!stages.network.checked) {
        stages.network = { checked: true, outcome: 'failed' };
      }
      finish();
    });
    client.once('close', () => {
      if (!done && check()) finish();
    });
    try {
      client.connect({
        host: profile.host,
        port: profile.port,
        username: profile.username,
        readyTimeout: 10000,
        tryKeyboard: false,
        ...(secret ?? {}),
        hostVerifier: (key: Buffer) => {
          if (!check()) return false;
          const observed =
            'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
          if (!expectedFingerprint || observed !== expectedFingerprint) {
            stages.identity = {
              checked: true,
              outcome: expectedFingerprint ? 'changed' : 'untrusted',
            };
            reason = 'host_identity_' + stages.identity.outcome;
            return false;
          }
          stages.identity = { checked: true, outcome: 'ok' };
          if (
            !secret ||
            (profile.auth === 'password'
              ? secret.password === undefined
              : secret.privateKey === undefined)
          ) {
            stages.authentication = { checked: false, outcome: 'missing_credentials' };
            reason = 'missing_credentials';
            return false;
          }
          return true;
        },
        // Do not attempt SSH none/keyboard-interactive authentication or fallback credentials.
        authHandler: () => {
          if (!check() || stages.identity.outcome !== 'ok' || !secret) return false;
          if (stages.authentication.checked) return false;
          stages.authentication = { checked: true, outcome: 'failed' };
          return profile.auth === 'password'
            ? { type: 'password', username: profile.username, password: secret.password! }
            : {
                type: 'publickey',
                username: profile.username,
                key: secret.privateKey!,
                passphrase: secret.passphrase,
              };
        },
      });
    } catch {
      if (check()) {
        reason = 'configuration_failed';
        finish();
      }
    }
  });
}
