import {
  installedPluginSchema,
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
    port: 3777,
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
    this.data.profiles = [...this.data.profiles.filter((p) => p.id !== profile.id), profile];
    if (profile.group && !this.data.groups.includes(profile.group))
      this.data.groups = this.groups();
    await this.persist();
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
