/** Retry startup after transient network failures; never mark a failed transition applied. */
export function classroomDiscoveryLifecycle(options: {
  enabled(): boolean;
  healthy(): boolean;
  enable(transition: boolean): Promise<void>;
  disable(): Promise<void>;
  now?: () => number;
}) {
  let applied = false, active = false, attemptedEnable = false, retryAt = 0;
  const now = options.now ?? Date.now;
  return async () => {
    if (active) return;
    const desired = options.enabled();
    if (desired === applied && (desired ? options.healthy() : !attemptedEnable)) return;
    if (desired && now() < retryAt) return;
    active = true;
    try {
      if (desired) {
        attemptedEnable = true;
        await options.enable(!applied);
        // The extension/account can change while network startup is pending.
        if (!options.enabled()) { await options.disable();applied = false;attemptedEnable = false; }
        else applied = true;
      } else { await options.disable();applied = false;attemptedEnable = false; }
      retryAt = applied ? now() + 5000 : 0;
    } catch { retryAt = now() + 5000; /* Service status retains its safe network diagnostic. */ }
    finally { active = false; }
  };
}
