import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { aiEventRuleSchema, aiPluginEventSchema, type AiEventRule, type AiEventRun, type AiEventSource, type AiPluginEvent } from '../shared/ai-events';

export interface AiEventHost {
  sources(): AiEventSource[];
  authorize(rule: AiEventRule, event: AiPluginEvent): boolean | Promise<boolean>;
  /** Must enforce existing thread/tool permissions and bound model input/output to reservedTokens.
   * The prompt is user configuration; event.payload is untrusted third-party data, never authority. */
  execute(input: { rule: AiEventRule; event: AiPluginEvent; prompt: string; signal: AbortSignal; reservedTokens: number }): Promise<void>;
}
type Pending = { run: AiEventRun; event: AiPluginEvent };
type State = { version: 1; rules: AiEventRule[]; runs: AiEventRun[]; seen: Record<string, number> };
const DAY = 86400000, RETENTION = 7 * DAY;
const clone = <T>(value: T): T => structuredClone(value);

/** Single-owner service: instantiate once per application data directory. No event bodies persisted. */
export class AiEventService {
  private state: State = { version: 1, rules: [], runs: [], seen: {} };
  private pending: Pending[] = [];
  private active = new Map<string, { ruleId: string; event: AiPluginEvent; controller: AbortController }>();
  private serial: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private ready = false;
  private readonly now: () => number;
  constructor(private readonly options: { path: string; host: AiEventHost; now?: () => number; codec: { encrypt(value: string): string | Promise<string>; decrypt(value: string): string | Promise<string> } }) { this.now = options.now ?? Date.now; }
  private lock<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.serial.then(action); this.serial = operation.catch(() => {}); return operation;
  }
  private async persist() {
    try {
      await mkdir(dirname(this.options.path), { recursive: true });
      const temp = `${this.options.path}.tmp`;
      await writeFile(temp, await this.options.codec.encrypt(JSON.stringify(this.state)), { mode: 0o600 });
      await rename(temp, this.options.path);
    } catch (error) { this.stopped = true; for (const item of this.active.values()) item.controller.abort(); throw error; }
  }
  async init() {
    return this.lock(async () => {
      if (this.ready) return;
      try {
        const raw = JSON.parse(await this.options.codec.decrypt(await readFile(this.options.path, 'utf8'))) as State;
        if (raw.version !== 1 || !Array.isArray(raw.rules) || !Array.isArray(raw.runs) || !raw.seen || raw.rules.length > 100 || raw.runs.length > 10000 || Object.keys(raw.seen).length > 20000) throw new Error('Invalid event subscription storage');
        raw.rules = raw.rules.map(rule => aiEventRuleSchema.parse(rule));
        if (raw.runs.some(run => !run.id || !run.ruleId || !Number.isFinite(run.createdAt) || !Number.isFinite(run.reservedTokens)) || Object.values(raw.seen).some(time => !Number.isFinite(time))) throw new Error('Invalid event subscription journal');
        this.state = raw;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      for (const run of this.state.runs) {
        if (run.status === 'running' || run.status === 'queued') { run.status = 'unknown'; run.reason = '应用曾中断；不自动重试'; run.finishedAt = this.now(); }
      }
      await this.persist(); this.ready = true;
    });
  }
  private check() { if (!this.ready || this.stopped) throw new Error('Event service unavailable'); }
  list() { return clone(this.state.rules); }
  sources() { return clone(this.options.host.sources()); }
  runs(ruleId?: string) { return clone(this.state.runs.filter(run => !ruleId || run.ruleId === ruleId).slice(-200).reverse()); }
  snapshot() { return { rules: this.list(), sources: this.sources(), runs: this.runs() }; }
  async save(input: unknown) {
    const rule = aiEventRuleSchema.parse(input);
    return this.lock(async () => {
      this.check();
      if (!this.state.rules.some(item => item.id === rule.id) && this.state.rules.length >= 100) throw new Error('最多保存 100 个事件订阅');
      const source = this.sources().find(item => item.id === rule.source);
      if (rule.enabled && (!source?.available || !source.eventTypes.some(item => item.id === rule.eventType))) throw new Error('事件来源当前不可用');
      this.cancelRule(rule.id, '订阅已修改');
      this.state.rules = [...this.state.rules.filter(item => item.id !== rule.id), rule];
      await this.persist(); return clone(rule);
    });
  }
  async remove(id: string) { return this.lock(async () => { this.check(); this.cancelRule(id, '订阅已删除'); this.state.rules = this.state.rules.filter(rule => rule.id !== id); await this.persist(); }); }
  private cancelRule(id: string, reason: string) {
    for (const item of this.pending.filter(item => item.run.ruleId === id)) { item.run.status = 'cancelled'; item.run.reason = reason; item.run.finishedAt = this.now(); }
    this.pending = this.pending.filter(item => item.run.ruleId !== id);
    for (const item of this.active.values()) if (item.ruleId === id) item.controller.abort(reason);
  }
  private matches(rule: AiEventRule, event: AiPluginEvent) {
    return rule.enabled && rule.source === event.source && rule.eventType === event.type && (!rule.subscriptionId || rule.subscriptionId === event.subscriptionId)
      && !(rule.filter.excludeSelf && event.isSelf) && !(rule.filter.privateOnly && event.isGroup)
      && (!rule.filter.conversationIds.length || rule.filter.conversationIds.includes(event.conversationId))
      && (!rule.filter.senderIds.length || rule.filter.senderIds.includes(event.senderId));
  }
  private async allowed(rule: AiEventRule, event: AiPluginEvent) {
    const source = this.sources().find(item => item.id === rule.source);
    if (!source?.available || !source.eventTypes.some(type => type.id === rule.eventType)) return false;
    try { return await this.options.host.authorize(clone(rule), clone(event)); } catch { return false; }
  }
  async ingest(input: unknown): Promise<{ accepted: number; duplicate: boolean }> {
    const event = aiPluginEventSchema.parse(input);
    if (Buffer.byteLength(JSON.stringify(event)) > 32768) throw new Error('Event exceeds 32 KiB budget');
    const result = await this.lock(async () => {
      this.check(); const now = this.now();
      if (event.occurredAt < now - RETENTION || event.occurredAt > now + 60000) throw new Error('Event outside retained time window');
      this.state.runs = this.state.runs.filter(run => run.createdAt >= now - RETENTION || run.status === 'running' || run.status === 'queued');
      for (const [key, time] of Object.entries(this.state.seen)) if (time < now - RETENTION) delete this.state.seen[key];
      const key = createHash('sha256').update(JSON.stringify([event.source, event.accountId, event.type, event.id])).digest('hex');
      if (Object.hasOwn(this.state.seen, key)) return { accepted: 0, duplicate: true };
      if (Object.keys(this.state.seen).length >= 20000) throw new Error('Event deduplication capacity exhausted');
      this.state.seen[key] = now;
      let accepted = 0;
      for (const rule of this.state.rules) {
        if (!this.matches(rule, event)) continue;
        if (this.state.runs.length >= 10000) break;
        const recent = this.state.runs.filter(run => run.ruleId === rule.id && run.reservedTokens > 0 && run.createdAt > now - DAY);
        let reason = '';
        if (!await this.allowed(rule, event)) reason = '权限或目标不可用';
        else if (this.pending.length >= 64) reason = '事件队列已满';
        else if (recent.some(run => now - run.createdAt < rule.cooldownSeconds * 1000)) reason = '冷却中';
        else if (recent.filter(run => run.createdAt > now - 3600000).length >= rule.maxRunsPerHour || recent.length >= rule.maxRunsPerDay) reason = '已达到运行次数预算';
        else if (recent.reduce((sum, run) => sum + run.reservedTokens, 0) + rule.reservedTokensPerRun > rule.maxReservedTokensPerDay) reason = '已达到预留 token 预算';
        const run: AiEventRun = { id: randomUUID(), ruleId: rule.id, threadId: rule.threadId, eventId: event.id, createdAt: now, status: reason ? 'skipped' : 'queued', reservedTokens: reason ? 0 : rule.reservedTokensPerRun, ...(reason ? { reason, finishedAt: now } : {}) };
        this.state.runs.push(run);
        if (!reason) { this.pending.push({ run, event }); accepted++; }
      }
      await this.persist(); return { accepted, duplicate: false };
    });
    void this.pump(); return result;
  }
  /** Call immediately after permission/provider/thread/subscription changes. */
  async revalidate() {
    await this.lock(async () => {
      this.check();
      let changed = false;
      for (const item of [...this.pending]) {
        const rule = this.state.rules.find(rule => rule.id === item.run.ruleId);
        if (!rule || !this.matches(rule, item.event) || !await this.allowed(rule, item.event)) { this.cancelRule(item.run.ruleId, '授权或来源已撤销'); changed = true; }
      }
      for (const item of this.active.values()) {
        const rule = this.state.rules.find(rule => rule.id === item.ruleId);
        if (!rule || !this.matches(rule, item.event) || !await this.allowed(rule, item.event)) item.controller.abort('授权或来源已撤销');
      }
      if (changed) await this.persist();
    });
    void this.pump();
  }
  private async pump() {
    await this.lock(async () => {
      if (this.stopped) return;
      while (this.active.size < 2) {
        const index = this.pending.findIndex(item => !this.active.has(item.run.threadId));
        if (index < 0) break;
        const item = this.pending.splice(index, 1)[0];
        const rule = this.state.rules.find(rule => rule.id === item.run.ruleId);
        if (!rule || !this.matches(rule, item.event) || !await this.allowed(rule, item.event)) { item.run.status = 'cancelled'; item.run.reason = '执行前授权检查失败'; item.run.finishedAt = this.now(); await this.persist(); continue; }
        const controller = new AbortController();
        this.active.set(rule.threadId, { ruleId: rule.id, event: item.event, controller });
        item.run.status = 'running'; item.run.startedAt = this.now();
        await this.persist(); // durable reservation BEFORE any model/tool side effect
        void this.execute(item, clone(rule), controller);
      }
    }).catch(() => { this.stopped = true; });
  }
  private async execute(item: Pending, rule: AiEventRule, controller: AbortController) {
    let status: AiEventRun['status'] = 'completed'; let reason: string | undefined;
    try { await this.options.host.execute({ rule, event: clone(item.event), prompt: rule.prompt, signal: controller.signal, reservedTokens: rule.reservedTokensPerRun }); }
    catch { status = controller.signal.aborted ? 'cancelled' : 'failed'; reason = controller.signal.aborted ? '执行已取消；已发生的操作不会撤回' : '执行失败；不自动重试，请查看智能体会话'; }
    if (controller.signal.aborted) { status = 'cancelled'; reason = '执行已取消；已发生的操作不会撤回'; }
    await this.lock(async () => { item.run.status = status; item.run.reason = reason; item.run.finishedAt = this.now(); this.active.delete(rule.threadId); await this.persist(); }).catch(() => {});
    void this.pump();
  }
  async close() { await this.lock(async () => { this.stopped = true; for (const rule of this.state.rules) this.cancelRule(rule.id, '应用正在关闭'); await this.persist(); }); }
}
