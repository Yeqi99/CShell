import { CloudSync } from '../core/cloud-sync';
import { defaults } from '../shared/contracts';
import { sharedAiConfigSchema } from '../shared/shared-ai';
import type { SecretCodec } from '../core/store';
import type { ClientVault } from '../core/client/identity';
import type { CagentAssistant } from './assistant';
import { z } from 'zod';
const bundle = z
  .object({
    format: z.literal(1),
    ai: sharedAiConfigSchema,
    store: z.unknown(),
    devices: z.unknown(),
    http: z.unknown(),
    assets: z.unknown(),
  })
  .passthrough();
export class CagentCloud {
  readonly sync: CloudSync;
  devices() {
    return structuredClone(this.cached.devices);
  }
  deviceId() {
    return this.hooks?.deviceId();
  }
  private cached: any;
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private pending: Promise<void> = Promise.resolve();
  private paused = false;
  private closed = false;
  private transportError: string | undefined;
  private tick() {
    if (this.ticking || this.paused || this.closed) return this.pending;
    this.pending = this.runTick();
    return this.pending;
  }
  private lastEnroll = 0;
  private hooks?: {
    deviceId: () => string;
    enroll: () => Promise<any>;
    start: (relay: unknown) => Promise<void>;
    stop: () => Promise<void>;
  };
  setTransport(hooks: NonNullable<CagentCloud['hooks']>) {
    this.hooks = hooks;
  }
  private async runTick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (this.sync.status().email && this.hooks) {
        const profile = await this.sync.accountRequest('/v1/account');
        const catalog = await this.sync.accountRequest('/v1/models');
        await this.assistant.ensureOfficialModels(catalog.models.map((m: { id: string }) => m.id));
        {
          if (Date.now() - this.lastEnroll > 30000) {
            const device = await this.hooks.enroll();
            const { accountPassword, ...publicDevice } = device;
            const answer = await this.sync.accountRequest('/v1/devices/register', publicDevice);
            if (profile.membership.active && answer.relay) await this.hooks.start(answer.relay);
            else await this.hooks.stop();
            const entry = {
              protocol: 1,
              ...device,
              host: (answer.endpoint ?? answer.relay).host,
              port: (answer.endpoint ?? answer.relay).port,
              accountManaged: true,
            };
            this.cached.devices = [
              ...this.cached.devices.filter((d: any) => d.deviceId !== device.deviceId),
              entry,
            ];
            const profiles = this.cached.store.profiles;
            if (!profiles.some((p: any) => p.id === device.deviceId))
              profiles.push({
                id: device.deviceId,
                protocol: 'client',
                name: device.name,
                host: entry.host,
                port: entry.port,
                username: 'agent',
                auth: 'password',
                group: '我的云端机器',
                favorite: false,
              });
            if (!this.cached.store.groups.includes('我的云端机器'))
              this.cached.store.groups.push('我的云端机器');
            this.lastEnroll = Date.now();
            this.transportError = undefined;
          }
        }
        if (!profile.membership.active) await this.hooks.stop();
      }
      await this.sync.autoSync();
    } catch (e) {
      this.transportError = e instanceof Error ? e.message : '云连接暂时不可用';
    } finally {
      this.ticking = false;
    }
  }

  constructor(
    directory: string,
    codec: SecretCodec,
    private vault: ClientVault,
    private assistant: CagentAssistant,
  ) {
    this.sync = new CloudSync(directory, codec, {
      export: async () => ({ ...this.cached, ai: this.assistant.cloudExport() }),
      validate: (v) => {
        bundle.parse(v);
      },
      import: async (v) => {
        const next = bundle.parse(v);
        await assistant.cloudImport(next.ai);
        await vault.write('cloud-bundle', next);
        this.cached = next;
      },
    });
  }
  async load() {
    this.assistant.officialCredential = () => this.sync.sessionCredential();
    this.cached = (await this.vault.read('cloud-bundle', bundle)) ?? {
      format: 1,
      store: {
        profiles: [],
        groups: [],
        preferences: defaults,
        presets: [],
        monitorViews: [],
        hosts: {},
        secrets: {},
      },
      ai: this.assistant.cloudExport(),
      devices: [],
      http: [],
      assets: {},
    };
    await this.sync.load();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 15000);
    this.timer.unref();
  }
  async call(method: string, input: unknown) {
    if (method === 'account.status')
      return { ...(await this.sync.accountStatus()), transportError: this.transportError };
    if (method === 'account.login') {
      const q = z
        .object({ email: z.email(), password: z.string().min(8).max(128) })
        .strict()
        .parse(input);
      this.paused = true;
      try {
        await this.pending;
        await this.hooks?.stop();
        const result = await this.sync.login(q.email, q.password, true);
        this.lastEnroll = 0;
        return result;
      } finally {
        this.paused = false;
        void this.tick();
      }
    }
    if (method === 'account.code') {
      const q = z.object({ email: z.email() }).strict().parse(input);
      return this.sync.requestCode(q.email);
    }
    if (method === 'account.register') {
      const q = z
        .object({
          email: z.email(),
          password: z.string().min(8).max(128),
          code: z.string().regex(/^\d{6}$/),
        })
        .strict()
        .parse(input);
      if (this.sync.status().email) throw Error('请先退出当前账号，再创建账号');
      this.paused = true;
      try {
        await this.pending;
        const result = await this.sync.register(q.email, q.code, q.password);
        this.lastEnroll = 0;
        return result;
      } finally {
        this.paused = false;
        void this.tick();
      }
    }
    if (method === 'account.logout') {
      this.paused = true;
      try {
        await this.pending;
        if (this.hooks) {
          await this.hooks.stop();
          await this.sync.accountRequest('/v1/devices/remove', { deviceId: this.hooks.deviceId() });
        }
        return await this.sync.logout();
      } finally {
        this.lastEnroll = 0;
        this.paused = false;
      }
    }
    if (method === 'account.models')
      return this.assistant
        .cloudExport()
        .providers.map(({ key, ...p }) => ({ ...p, hasKey: !!key }));
    if (method === 'account.model.select') {
      const { id } = z.object({ id: z.string().uuid() }).strict().parse(input);
      const data = this.assistant.cloudExport(),
        p = data.providers.find((p) => p.id === id && !p.extension);
      if (!p) throw Error('基座不可用');
      const s = this.assistant.snapshot();
      const { keyConfigured, ...settings } = s;
      return this.assistant.configure({ ...settings, endpoint: p.url, model: p.model, key: p.key });
    }
    throw Error('未知账号操作');
  }
  async close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await this.pending;
    await this.hooks?.stop();
  }
}
