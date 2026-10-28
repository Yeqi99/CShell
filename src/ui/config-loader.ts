import type { Config, Preferences } from '../shared/contracts';

/** One ordering boundary for initial loads, cloud refreshes and preference saves. */
export class ConfigLoader {
  private revision = 0;
  private preferenceRevision = 0;
  private pendingPreferences?: { revision: number; value: Preferences };
  constructor(
    private read: () => Promise<Config>,
    private publish: (update: (current: Config) => Config) => void,
  ) {}
  async load() {
    const revision = ++this.revision;
    const next = await this.read();
    if (revision === this.revision) {
      const pending = this.pendingPreferences;
      this.publish(() => pending ? { ...next, preferences: pending.value } : next);
    }
    return next;
  }
  previewPreferences(value: Preferences) {
    ++this.revision; // Discard snapshots requested before this local edit.
    const revision = ++this.preferenceRevision;
    this.pendingPreferences = { revision, value };
    // Never restore connections/groups from the render that created a callback.
    this.publish(current => ({ ...current, preferences: value }));
    return revision;
  }
  async settlePreferences(revision: number) {
    if (this.pendingPreferences?.revision !== revision) return;
    this.pendingPreferences = undefined;
    await this.load();
  }
}
