import { defaultMcpPort } from '../shared/mcp-endpoint';
import { CloudImportConflict, undoImportedFields } from './cloud-import';
import {
  installedPluginSchema,
  pluginManifestSchema,
  catalogSchema,
  initialPlugins,
  builtinPlugins,
  pluginEnabled,
  type InstalledPlugin,
} from '../shared/plugins';
import { toolsDefaults, toolsSettingsSchema, type ToolsSettings } from '../shared/docker';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { monitorViewSchema, type MonitorView } from '../shared/monitor-views';
import { z } from 'zod';
import {
  defaults,
  groupActionSchema,
  groupNameSchema,
  type GroupAction,
  presetSchema,
  mcpSettingsSchema,
  type McpSettings,
  preferencesSchema,
  profileSchema,
  type Profile,
  type Preferences,
} from '../shared/contracts';

const portableExtensionsSchema=z.object({commandSuggestions:z.boolean(),dockerSocket:toolsSettingsSchema.shape.dockerSocket,commands:z.record(z.string().max(100),pluginManifestSchema.shape.commands)}).strict();
const schema = z.object({
  version: z.literal(1),
  monitorViews: z.array(monitorViewSchema).max(100).default([]),
  tools: toolsSettingsSchema.default(toolsDefaults),
  plugins: z.array(installedPluginSchema).max(100).optional(),
  pluginSource: z
    .object({ url: z.url().startsWith('https://'), entries: catalogSchema.shape.plugins })
    .nullable()
    .default(null),
  presets: z.array(presetSchema).max(100).default([]),
  mcp: mcpSettingsSchema.default({
    enabled: false,
    port: defaultMcpPort(),
    allowedProfiles: [],
    allowCommands: false,
  }),
  mcpToken: z.string().optional(),
  mcpClientTokens: z.record(z.string(), z.string()).optional(),
  profiles: z.array(profileSchema),
  groups: z.array(groupNameSchema).max(1000).default([]),
  preferences: preferencesSchema,
  secrets: z.record(z.string(), z.string()),
  hosts: z.record(z.string(), z.string()),
});
type Data = z.infer<typeof schema>;
export interface SecretCodec {
  encrypt(value: string): Promise<string>;
  decrypt(value: string): Promise<string>;
}
export class Store {
  /** Explicit portable allowlist. Never include MCP grants, local identity or plugin grants. */
  async cloudExport() {
    const secrets: Record<string, unknown> = {};
    const snapshot = structuredClone(this.data);
    for (const profile of snapshot.profiles) {
      if (snapshot.secrets[profile.id]) secrets[profile.id] = JSON.parse(await this.codec.decrypt(snapshot.secrets[profile.id]));
    }
    return { profiles: snapshot.profiles, groups: snapshot.groups, preferences: snapshot.preferences,
      presets: snapshot.presets, monitorViews: snapshot.monitorViews, hosts: snapshot.hosts, secrets, extensions:{commandSuggestions:snapshot.tools.commandSuggestions,dockerSocket:snapshot.tools.dockerSocket,commands:Object.fromEntries(this.plugins().map(p=>[p.manifest.id,p.manifest.commands]))} };
  }
  cloudValidate(value: unknown) {
    const result = schema.pick({profiles:true, groups:true, preferences:true, presets:true, monitorViews:true, hosts:true}).extend({
      extensions:portableExtensionsSchema.optional(),
      secrets: z.record(z.string().uuid(), z.object({password:z.string().max(65536).optional(), privateKey:z.string().max(262144).optional(), passphrase:z.string().max(65536).optional()}).strict()),
    }).strict().parse(value);
    if (new Set(result.profiles.map(p=>p.id)).size !== result.profiles.length) throw new Error('云端存在重复连接');
    for (const [endpoint, fingerprint] of Object.entries(result.hosts)) {
      if (this.data.hosts[endpoint] && this.data.hosts[endpoint] !== fingerprint) throw new Error('云端主机身份与本机不一致，请手动核对');
    }
    return result;
  }
  cloudCheckpoint() { return JSON.stringify(this.data); }
  async cloudImport(value: unknown, restoreHosts = false, expected = this.cloudCheckpoint()) {
    const unchanged = () => { if (this.cloudCheckpoint() !== expected) throw new CloudImportConflict(); };
    unchanged();
    const next = this.cloudValidate(value), secrets: Record<string,string> = {};
    for (const profile of next.profiles) if (next.secrets[profile.id]) secrets[profile.id] = await this.codec.encrypt(JSON.stringify(next.secrets[profile.id]));
    unchanged(); // OS credential encryption can overlap a local connection/group save.
    const task = this.writes.catch(() => {}).then(async () => {
      unchanged(); // Recheck at the same serialized boundary as ordinary saves.
      const previous = structuredClone(this.data);
      const {extensions,...portable}=next;
      this.data = {...this.data, ...portable, secrets, hosts:restoreHosts?next.hosts:{...this.data.hosts,...next.hosts},
        ...(extensions ? {tools:{...this.data.tools,commandSuggestions:extensions.commandSuggestions,dockerSocket:extensions.dockerSocket},
          plugins:this.plugins().map(p=>({...p,manifest:{...p.manifest,commands:extensions.commands[p.manifest.id]??p.manifest.commands}}))} : {})};
      const applied = structuredClone(this.data);
      try {
        await mkdir(this.directory, {recursive:true});
        const temporary = join(this.directory, 'config.json.tmp');
        await writeFile(temporary, JSON.stringify(applied, null, 2), {mode:0o600});
        await rename(temporary, join(this.directory, 'config.json'));
      } catch (error) {
        const rollback = undoImportedFields(previous, applied, this.data);
        this.data = rollback.value as Data;
        if (rollback.conflict) throw new CloudImportConflict();
        throw error;
      }
    });
    this.writes = task.then(() => {}, () => {});
    await task;
  }
  monitorViews(): MonitorView[] { return structuredClone(this.data.monitorViews); }
  async saveMonitorView(value: MonitorView) {
    const view = monitorViewSchema.parse(value);
    const next = [...this.data.monitorViews.filter(v => v.id !== view.id), view];
    if (next.length > 100) throw new Error('最多保存 100 个视图');
    this.data.monitorViews = next;
    await this.persist();
  }
  async deleteMonitorView(id: string) {
    this.data.monitorViews = this.data.monitorViews.filter(v => v.id !== id);
    await this.persist();
  }
  private data: Data = schema.parse({
    version: 1,
    profiles: [],
    preferences: defaults,
    secrets: {},
    hosts: {},
  });
  private writes: Promise<void> = Promise.resolve();
  encryptPrivate(value: string) {
    return this.codec.encrypt(value);
  }
  decryptPrivate(value: string) {
    return this.codec.decrypt(value);
  }
  constructor(
    private directory: string,
    private codec: SecretCodec,
  ) {}
  async load() {
    try {
      this.data = schema.parse(
        JSON.parse(await readFile(join(this.directory, 'config.json'), 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('Configuration could not be read. Original file was preserved.', {
          cause: error,
        });
    }
  }
  presets() {
    return structuredClone(this.data.presets);
  }
  async savePreset(name: string, preferences: Preferences) {
    const existing = this.data.presets.find((p) => p.name === name.trim());
    const next = presetSchema.parse({ id: existing?.id ?? randomUUID(), name, preferences });
    if (!existing && this.data.presets.length >= 100) throw new Error('Maximum 100 presets');
    this.data.presets = [...this.data.presets.filter((p) => p.id !== next.id), next];
    await this.persist();
  }
  async deletePreset(id: string) {
    this.data.presets = this.data.presets.filter((p) => p.id !== id);
    await this.persist();
  }
  pluginSource() {
    return structuredClone(this.data.pluginSource);
  }
  async setPluginSource(value: NonNullable<Data['pluginSource']>) {
    this.data.pluginSource = schema.shape.pluginSource.parse(value);
    await this.persist();
  }
  plugins() {
    return structuredClone(
      this.data.plugins ??
        initialPlugins(this.data.tools.dockerEnabled, this.data.tools.commandSuggestions),
    );
  }
  async setPlugins(plugins: InstalledPlugin[]) {
    this.data.plugins = z.array(installedPluginSchema).max(100).parse(plugins);
    this.data.tools.dockerEnabled = pluginEnabled(plugins, 'docker');
    this.data.tools.commandSuggestions = pluginEnabled(plugins, 'commands');
    await this.persist();
  }
  async setTools(settings: ToolsSettings) {
    const plugins = this.plugins();
    for (const [provider, enabled] of [
      ['docker', settings.dockerEnabled],
      ['commands', settings.commandSuggestions],
    ] as const) {
      const existing = plugins.find((p) => p.manifest.provider === provider);
      if (existing) existing.enabled = enabled;
      else if (enabled)
        plugins.push({
          manifest: builtinPlugins.find((p) => p.provider === provider)!,
          enabled,
          source: 'bundled',
        });
    }
    this.data.plugins = plugins;
    this.data.tools = toolsSettingsSchema.parse(settings);
    await this.persist();
  }
  mcpSettings() {
    return structuredClone(this.data.mcp);
  }
  async setMcpSettings(settings: McpSettings) {
    const next = mcpSettingsSchema.parse(settings);
    const tokens = { ...this.data.mcpClientTokens };
    const ids = new Set(next.clients?.map((c) => c.id));
    for (const id of Object.keys(tokens)) if (!ids.has(id)) delete tokens[id];
    // Never publish expanded in-memory grants before the durable configuration succeeds.
    await this.persist({ mcp: next, mcpClientTokens: tokens });
  }
  async mcpToken(clientId?: string) {
    if (clientId) {
      const token = this.data.mcpClientTokens?.[clientId];
      return token ? this.codec.decrypt(token) : undefined;
    }
    return this.data.mcpToken ? this.codec.decrypt(this.data.mcpToken) : undefined;
  }
  async setMcpToken(token: string, clientId?: string) {
    if (clientId) {
      const encrypted = await this.codec.encrypt(token);
      if (!this.data.mcp.clients?.some((c) => c.id === clientId))
        throw new Error('API client was removed');
      (this.data.mcpClientTokens ??= {})[clientId] = encrypted;
      await this.persist();
      return;
    }
    this.data.mcpToken = await this.codec.encrypt(token);
    await this.persist();
  }
  snapshot() {
    return structuredClone({
      plugins: this.plugins(),
      tools: this.data.tools,
      groups: this.groups(),
      profiles: this.data.profiles,
      preferences: this.data.preferences,
      savedCredentials: Object.keys(this.data.secrets),
    });
  }
  private groups() {
    return [
      ...new Set([...this.data.groups, ...this.data.profiles.map((p) => p.group).filter(Boolean)]),
    ];
  }
  async manageGroup(input: GroupAction) {
    const action = groupActionSchema.parse(input);
    const groups = this.groups();
    if (action.type === 'create') {
      if (groups.includes(action.name)) throw new Error('GROUP_EXISTS');
      if (groups.length >= 1000) throw new Error('GROUP_LIMIT');
      this.data.groups = [...groups, action.name];
    } else {
      if (!groups.includes(action.name)) throw new Error('GROUP_MISSING');
      const next = action.type === 'rename' ? action.next : '';
      if (next === action.name) return;
      if (next && groups.includes(next)) throw new Error('GROUP_EXISTS');
      this.data.groups = groups.filter((name) => name !== action.name);
      if (next) this.data.groups.push(next);
      this.data.profiles = this.data.profiles.map((profile) =>
        profile.group === action.name ? { ...profile, group: next } : profile,
      );
    }
    await this.persist();
  }
  profile(id: string) {
    const profile = this.data.profiles.find((p) => p.id === id);
    if (!profile) throw new Error('Unknown server');
    return { ...profile };
  }
  async saveProfile(value: Profile) {
    const profile = profileSchema.parse(value),
      old = this.data.profiles.find((p) => p.id === profile.id);
    const groups = this.groups();
    if (profile.group && !groups.includes(profile.group) && groups.length >= 1000)
      throw new Error('GROUP_LIMIT');
    this.data.groups = groups;
    if (
      old &&
      (old.host !== profile.host ||
        old.port !== profile.port ||
        old.username !== profile.username ||
        old.auth !== profile.auth)
    )
      delete this.data.secrets[profile.id];
    this.data.profiles = old ? this.data.profiles.map(p => p.id === profile.id ? profile : p) : [...this.data.profiles, profile];
    if (profile.group && !this.data.groups.includes(profile.group))
      this.data.groups = this.groups();
    await this.persist();
  }
  /** Append a confirmed import in one durable write; never changes existing credentials or trust. */
  async moveProfile(id: string, group: string, before?: string) {
    const source = this.profile(id);
    if (group && !this.groups().includes(group)) throw new Error('GROUP_MISSING');
    if (before === id) return;
    if (before && this.profile(before).group !== group) throw new Error('目标分组已变更');
    const remaining = this.data.profiles.filter(p => p.id !== id);
    const targetIndex = before ? remaining.findIndex(p => p.id === before) : remaining.reduce((last, p, i) => p.group === group ? i + 1 : last, remaining.length);
    remaining.splice(targetIndex, 0, { ...source, group });
    if (JSON.stringify(remaining) === JSON.stringify(this.data.profiles)) return;
    this.data.profiles = remaining;
    await this.persist();
  }

  async importProfiles(values: { profile: Profile; password?: string }[], duplicates: 'skip' | 'keep') {
    if (!values.length || values.length > 5000) throw new Error('请选择 1 至 5000 条连接');
    if (!['skip', 'keep'].includes(duplicates)) throw new Error('重复项策略无效');
    const prepared = await Promise.all(values.map(async value => ({
      profile: profileSchema.parse(value.profile),
      secret: value.password === undefined ? undefined : await this.codec.encrypt(JSON.stringify({
        password: z.string().max(16000).parse(value.password),
      })),
    })));
    const endpoint = (p: Profile) => JSON.stringify([p.protocol ?? 'ssh', p.host.toLowerCase().replace(/\.$/, ''), p.port, p.username]);
    const task = this.writes.catch(() => {}).then(async () => {
      const known = new Set(this.data.profiles.map(endpoint));
      const ids = new Set(this.data.profiles.map(p => p.id));
      const accepted: typeof prepared = [];
      for (const value of prepared) {
        if (!['ssh', 'rdp', 'sftp', 'ftp', 'ftps'].includes(value.profile.protocol ?? 'ssh')) throw new Error('此类型不能批量导入');
        if (ids.has(value.profile.id)) throw new Error('连接标识已存在，请重新预览');
        ids.add(value.profile.id);
        const key = endpoint(value.profile);
        if (duplicates === 'skip' && known.has(key)) continue;
        known.add(key); accepted.push(value);
      }
      const groups = [...new Set([...this.groups(), ...accepted.map(v => v.profile.group).filter(Boolean)])];
      if (groups.length > 1000) throw new Error('GROUP_LIMIT');
      const secrets = Object.fromEntries(accepted.filter(v => v.secret !== undefined).map(v => [v.profile.id, v.secret!]));
      const data = { ...this.data, groups, profiles: [...this.data.profiles, ...accepted.map(v => v.profile)], secrets: { ...this.data.secrets, ...secrets } };
      await mkdir(this.directory, { recursive: true });
      const temporary = join(this.directory, 'config.json.tmp');
      await writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
      await rename(temporary, join(this.directory, 'config.json'));
      // Preserve unrelated in-memory edits made while the filesystem write awaited.
      this.data.profiles.push(...accepted.map(v => v.profile));
      Object.assign(this.data.secrets, secrets);
      this.data.groups = [...new Set([...this.groups(), ...accepted.map(v => v.profile.group).filter(Boolean)])];
      return { imported: accepted.map(v => v.profile.id), skipped: values.length - accepted.length };
    });
    this.writes = task.then(() => {}, () => {});
    return task;
  }
  async deleteProfile(id: string) {
    this.data.groups = this.groups();
    this.data.profiles = this.data.profiles.filter((p) => p.id !== id);
    delete this.data.secrets[id];
    await this.persist();
  }
  async preferences(value: Preferences) {
    this.data.preferences = preferencesSchema.parse(value);
    await this.persist();
  }
  async setSecret(id: string, value: object | null) {
    if (value) this.data.secrets[id] = await this.codec.encrypt(JSON.stringify(value));
    else delete this.data.secrets[id];
    await this.persist();
  }
  async secret(
    id: string,
  ): Promise<{ password?: string; privateKey?: string; passphrase?: string } | undefined> {
    const encrypted = this.data.secrets[id];
    return encrypted ? JSON.parse(await this.codec.decrypt(encrypted)) : undefined;
  }
  host(endpoint: string) {
    return this.data.hosts[endpoint];
  }
  async trust(endpoint: string, fingerprint: string) {
    this.data.hosts[endpoint] = fingerprint;
    await this.persist();
  }
  private persist(mcp?: { mcp: McpSettings; mcpClientTokens: Record<string, string> }) {
    const next = this.writes
      .catch(() => {})
      .then(async () => {
        // Snapshot at the serialized write boundary so queued unrelated saves cannot
        // restore an older permission revision after a successful MCP update.
        const content = JSON.stringify({ ...this.data, ...mcp }, null, 2);
        await mkdir(this.directory, { recursive: true });
        const temporary = join(this.directory, 'config.json.tmp');
        await writeFile(temporary, content, { mode: 0o600 });
        await rename(temporary, join(this.directory, 'config.json'));
        if (mcp) Object.assign(this.data, mcp);
      });
    this.writes = next;
    return next;
  }
}
