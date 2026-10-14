import type { Bridge, Credentials, Profile } from '../shared/contracts';

export async function connectRequest(
  bridge: Pick<Bridge, 'connect' | 'connectTemporary' | 'cancelConnect' | 'disconnect'>,
  profile: Profile,
  credentials: Credentials,
  persist: boolean,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const requestId = crypto.randomUUID();
  const cancel = () => {
    void bridge.cancelConnect(requestId).catch(() => {});
  };
  // Dispatch before listening: cancellation must follow request registration over IPC.
  const pending = persist
    ? bridge.connect(profile.id, credentials, requestId)
    : bridge.connectTemporary(profile, credentials, requestId);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await pending;
    // Cancellation can race an already completed IPC reply. Never attach that session.
    if (signal?.aborted) {
      await bridge.disconnect(result.sessionId);
      throw signal.reason;
    }
    return result;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
