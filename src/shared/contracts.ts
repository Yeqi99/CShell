import type {CommandBridge} from './command-console';
import type {LinuxWorkspaceBridge} from './linux-workspace';
import type {MachineBrowserBridge} from './machine-browser';
import type { HttpBridge } from './http';
import type { WechatBridge } from './wechat';
import type { AgentBridge } from './agent';
import type { DesktopViewBridge } from './desktop-view';
import { clientShellSchema } from './client';
import type { ClientBridge } from './client';
import type { LocalTerminalBridge } from './local-terminal';
import { localShellSchema } from './local-terminal';
import type { ActivityBridge } from './activity';
import type { FloatingBridge } from './floating';
import type { MonitorViewsBridge } from './monitor-views';
import type { ExtensionBridge, InstalledPlugin } from './plugins';
import type { AiBridge } from './ai';
import type { UpdateBridge } from './updates';
import type {
  ToolsSettings,
  DockerSnapshot,
  DockerStats,
  DockerDetails,
  DockerAction,
  DockerResult,
} from './docker';
import { z } from 'zod';

const text = z.string().trim().min(1).max(255);
export const profileSchema = z
  .object({
    id: z.string().uuid(),
    protocol: z.enum(['ssh', 'client', 'http', 'rdp', 'sftp', 'ftp', 'ftps']).optional(),
    clientShell: clientShellSchema.optional(),
    clientDistribution: z.string().min(1).max(100).optional(),
    defaultConnectionView: z.enum(['visual', 'original']).optional(),
    name: text,
    host: z.string().trim().max(8192),
    port: z.number().int().min(0).max(65535),
    username: z.string().trim().max(255),
    group: z.string().trim().max(100),
    favorite: z.boolean(),
    auth: z.enum(['password', 'key']),
  })
  .strict()
  .superRefine((p, ctx) => {
    if ((p.protocol === 'ftp' || p.protocol === 'ftps') && p.auth !== 'password')
      ctx.addIssue({ code: 'custom', message: 'FTP uses password authentication' });
    if (p.protocol === 'http') {
      if (
        p.host ||
        p.username ||
        p.port !== 0 ||
        p.auth !== 'password' ||
        p.clientShell ||
        p.clientDistribution
      )
        ctx.addIssue({ code: 'custom', message: 'HTTP workspace has no machine endpoint' });
    } else if (!p.host || p.host.length > 255 || !p.username || p.port < 1)
      ctx.addIssue({ code: 'custom', message: 'Machine endpoint is incomplete' });
  });
export type Profile = z.infer<typeof profileSchema>;
export const groupNameSchema = z.string().trim().min(1).max(100);
export const groupActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), name: groupNameSchema }).strict(),
  z.object({ type: z.literal('rename'), name: groupNameSchema, next: groupNameSchema }).strict(),
  z.object({ type: z.literal('delete'), name: groupNameSchema }).strict(),
]);
export type GroupAction = z.infer<typeof groupActionSchema>;
export const appearanceAssetSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}\.(?:ttf|otf|woff|woff2|png)$/),
    name: z.string().min(1).max(255),
  })
  .strict();
export type AppearanceAsset = z.infer<typeof appearanceAssetSchema>;
export const layoutSchema = z
  .object({
    serverVisible: z.boolean().default(true),
    fileVisible: z.boolean().default(true),
    order: z
      .array(z.enum(['servers', 'terminal', 'files']))
      .length(3)
      .refine((v) => new Set(v).size === 3)
      .default(['servers', 'terminal', 'files']),
    serverWidth: z.number().min(170).max(500).default(218),
    fileWidth: z.number().min(240).max(600).default(340),
    agentWidth: z.number().min(320).max(900).default(500),
  })
  .strict();
export const apiCapabilitySchema = z.enum([
  'files.read',
  'files.create',
  'files.write',
  'directories.create',
  'directories.manage',
  'files.rename',
  'files.delete',
  'terminal.read',
  'terminal.input',
  'metrics.read',
  'agent.manage',
  'agent.hosting',
  'agent.relay',
  'http.use',
  'http.send',
  'http.send.local',
  'browser.read',
  'browser.control',
  'desktop.view',
  'desktop.control',
  'environments.read',
  'environments.manage',
  'applications.read',
  'applications.install',
  'docker.read',
  'docker.manage',
]);
export const apiTargetPolicySchema = z
  .object({
    allowCommands: z.boolean(),
    capabilities: z.array(apiCapabilitySchema).max(32),
    review: z.enum(['always', 'mutations', 'authorized']),
  })
  .strict();
const apiTargetPoliciesSchema = z
  .record(z.string().uuid(), apiTargetPolicySchema)
  .refine((v) => Object.keys(v).length <= 1000)
  .optional();
export const apiLocalFileRootSchema = z.object({
  id: z.string().uuid(),
  path: z.string().min(1).max(4096),
  name: z.string().min(1).max(255),
  identity: z.string().min(1).max(128),
  mutations: z.array(z.enum(['create', 'write', 'rename', 'delete', 'mkdir', 'rmdir', 'renameDirectory'])).max(7).optional(),
}).strict();
const apiLocalFileRoots = z.array(apiLocalFileRootSchema).max(32).refine((roots) => new Set(roots.map((root) => root.id)).size === roots.length).optional();
export const apiClientSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
    allowedProfiles: z.array(z.string().uuid()).max(1000),
    allowCommands: z.boolean(),
    allowedLocalShells: z.array(localShellSchema).max(100).optional(),
    localFileRoots: apiLocalFileRoots,
    applicationCapabilities: z
      .array(z.enum(['plugins.read', 'plugins.manage']))
      .max(2)
      .optional(),
    targetPolicies: apiTargetPoliciesSchema,
    capabilities: z.array(apiCapabilitySchema).max(32),
    review: z.enum(['always', 'mutations', 'authorized']),
    disclosure: z
      .object({
        mode: z.enum(['full', 'progressive', 'adaptive']),
        level: z.enum(['names', 'summary', 'contract', 'guide']),
        budgetBytes: z.number().int().min(1024).max(262144),
      })
      .strict(),
  })
  .strict();
export type ApiClient = z.infer<typeof apiClientSchema>;
export const mcpSettingsSchema = z
  .object({
    enabled: z.boolean(),
    port: z.number().int().min(1024).max(65535),
    allowedProfiles: z.array(z.string().uuid()).max(1000),
    allowCommands: z.boolean(),
    allowedLocalShells: z.array(localShellSchema).max(100).optional(),
    localFileRoots: apiLocalFileRoots,
    applicationCapabilities: z
      .array(z.enum(['plugins.read', 'plugins.manage']))
      .max(2)
      .optional(),
    targetPolicies: apiTargetPoliciesSchema,
    clients: z
      .array(apiClientSchema)
      .max(20)
      .refine(
        (values) => new Set(values.map((v) => v.id)).size === values.length,
        'Duplicate API client',
      )
      .optional(),
    capabilities: z.array(apiCapabilitySchema).max(32).optional(),
    review: z.enum(['always', 'mutations', 'authorized']).optional(),
    disclosure: z
      .object({
        mode: z.enum(['full', 'progressive', 'adaptive']),
        level: z.enum(['names', 'summary', 'contract', 'guide']),
        budgetBytes: z.number().int().min(1024).max(262144),
      })
      .strict()
      .optional(),
  })
  .strict();
export type McpSettings = z.infer<typeof mcpSettingsSchema>;
export interface McpStatus {
  revision: string;
  settings: McpSettings;
  running: boolean;
  error?: string;
  requests: number;
}
export const preferencesSchema = z
  .object({
    layout: layoutSchema.default({
      order: ['servers', 'terminal', 'files'],
      serverVisible: true,
      fileVisible: true,
      serverWidth: 218,
      fileWidth: 340,
      agentWidth: 500,
    }),
    defaultConnectionView: z.enum(['visual', 'original']).default('original'),
    defaultConnectionViewExplicit: z.boolean().optional(),
    workbenchView: z.enum(['overview', 'command', 'visual']).default('overview'),
    locale: z.enum(['zh-CN', 'en-US']),
    theme: z.enum(['dark', 'light']),
    uiFont: z.string().max(200),
    uiFontSize: z.number().min(9).max(20).default(14),
    sidebarFontSize: z.number().min(8).max(22).default(12),
    sidebarGroupSize: z.number().min(8).max(22).default(14),
    sidebarDetailSize: z.number().min(8).max(20).default(12),
    sidebarDensity: z.enum(['compact', 'comfortable', 'spacious']).default('comfortable'),
    terminalFont: z.string().max(200),
    fontSize: z.number().min(8).max(28),
    lineHeight: z.number().min(1).max(1.8).default(1.2),
    terminalClipboardKeys: z.boolean().default(true),
    terminalSemanticColors: z.boolean().default(true),
    uiFontAsset: appearanceAssetSchema.nullable().default(null),
    terminalFontAsset: appearanceAssetSchema.nullable().default(null),
    backgroundAsset: appearanceAssetSchema.nullable().default(null),
    backgroundOpacity: z.number().min(0).max(0.5).default(0.15),
    backgroundBlur: z.number().min(0).max(20).default(0),
    backgroundFit: z.enum(['cover', 'contain']).default('cover'),
    showAiExecution: z.boolean().default(true),
  })
  .strict()
  .overwrite(preferences => preferences.defaultConnectionView === 'visual' && !preferences.defaultConnectionViewExplicit
    ? { ...preferences, defaultConnectionView: 'original' as const }
    : preferences);
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaults: Preferences = {
  layout: {
    order: ['servers', 'terminal', 'files'],
    serverVisible: true,
    fileVisible: true,
    serverWidth: 218,
    fileWidth: 340,
    agentWidth: 500,
  },
  defaultConnectionView: 'original',
  defaultConnectionViewExplicit: false,
  workbenchView: 'overview',
  locale: 'zh-CN',
  theme: 'light',
  uiFont: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", sans-serif',
  uiFontSize: 14,
  sidebarFontSize: 12,
  sidebarGroupSize: 14,
  sidebarDetailSize: 12,
  sidebarDensity: 'comfortable',
  terminalFont: 'Cascadia Code, Consolas, Microsoft YaHei UI, monospace',
  fontSize: 14,
  lineHeight: 1.2,
  terminalClipboardKeys: true,
  terminalSemanticColors: true,
  uiFontAsset: null,
  terminalFontAsset: null,
  backgroundAsset: null,
  backgroundOpacity: 0.15,
  backgroundBlur: 0,
  backgroundFit: 'cover',
  showAiExecution: true,
};
export const presetSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    preferences: preferencesSchema,
  })
  .strict();
export type WorkspacePreset = z.infer<typeof presetSchema>;
export interface Config {
  plugins: InstalledPlugin[];
  tools: ToolsSettings;
  groups: string[];
  profiles: Profile[];
  preferences: Preferences;
  savedCredentials: string[];
}
export const credentialsSchema = z
  .object({
    password: z.string().max(65536).optional(),
    keyToken: z.string().uuid().optional(),
    passphrase: z.string().max(65536).optional(),
    remember: z.boolean(),
  })
  .strict();
export type Credentials = z.infer<typeof credentialsSchema>;
export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  symlink: boolean;
  size: number;
  modified: number;
}
export interface Transfer {
  id: string;
  sessionId: string;
  name: string;
  direction: 'upload' | 'download' | 'copy';
  done: number;
  total: number;
  state: 'running' | 'done' | 'cancelled' | 'failed';
  error?: string;
}
export const fileRefSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('local'),
      root: z.string().uuid(),
      path: z.string().min(1).max(4096),
    })
    .strict(),
  z
    .object({
      kind: z.literal('remote'),
      sessionId: z.string().uuid(),
      path: z.string().min(1).max(4096),
    })
    .strict(),
]);
export type FileRef = z.infer<typeof fileRefSchema>;
export interface Metrics {
  physicalDisks?: { name: string; size: number }[];
  disks?: { device: string; mount: string; total: number; used: number; percent: number }[];
  cpuModel?: string | null;
  cpu: number | null;
  cpuCount: number | null;
  memory: number | null;
  memoryUsed: number | null;
  memoryTotal: number | null;
  disk: number | null;
  diskUsed: number | null;
  diskTotal: number | null;
  latency: number;
  error?: string;
}
export type SessionEvent =
  | { type: 'data'; sessionId: string; data: string; sequence?: number }
  | { type: 'closed'; sessionId: string; error?: string }
  | { type: 'transfer'; transfer: Transfer };
export interface Bridge
  extends CommandBridge, LinuxWorkspaceBridge, MachineBrowserBridge,
    AgentBridge,
    DesktopViewBridge,
    HttpBridge,
    WechatBridge,
    ClientBridge,
    LocalTerminalBridge,
    ExtensionBridge,
    AiBridge,
    UpdateBridge,
    FloatingBridge,
    MonitorViewsBridge,
    ActivityBridge {
  classroomTasks?: import('./classroom-tasks').ClassroomTasksBridge;
  agentLan?: import('./agent-lan').AgentLanBridge;
  classroom?: import('./classroom').ClassroomBridge;
  readonly platform: string;
  networkDiagnostics?(): Promise<import('./network-probe').NetworkDiagnostics>;
  networkProbe?(input: { id: string; source: string; target: string }): Promise<import('./network-probe').NetworkProbeResult>;
  networkProbeCancel?(id: string): Promise<void>;
  connectionImportText?(text: string): Promise<import('./connection-batch').ConnectionImportPreview>;
  connectionImportFile?(delimiter: ',' | ';' | '\t'): Promise<import('./connection-batch').ConnectionImportPreview | null>;
  connectionImportPreview?(token: string, options: { mapping?: Partial<Record<import('./connection-batch').ImportColumn, number>>; username?: string }): Promise<import('./connection-batch').ConnectionImportPreview>;
  connectionImportApply?(token: string, rows: number[], policy: 'skip' | 'keep'): Promise<{ imported: string[]; skipped: number }>;
  connectionImportDiscard?(token: string): Promise<void>;
  networkStatus?(): Promise<import('./network-route').NetworkRouteStatus>;
  desktopLookGet?(id:string,legacy?:import('./desktop-look').DesktopLook):Promise<import('./desktop-look').DesktopLook|null>;
  desktopLookSave?(id:string,value:import('./desktop-look').DesktopLook|null):Promise<import('./desktop-look').DesktopLook|null>;
  onDesktopLookChanged?(listener:()=>void):()=>void;
  networkSave?(route: import('./network-route').NetworkRoute): Promise<import('./network-route').NetworkRouteStatus>;
  reportError(error: { message: string; stack?: string }): void;
  openDiagnostics(): Promise<void>;
  setAlwaysOnTop(enabled: boolean): Promise<boolean>;
  setMinimalMode(enabled: boolean): Promise<void>;
  configureTools(settings: ToolsSettings): Promise<void>;
  dockerSnapshot(sessionId: string): Promise<DockerSnapshot>;
  dockerStats(sessionId: string, id: string): Promise<DockerStats>;
  dockerDetails(sessionId: string, id: string): Promise<DockerDetails>;
  dockerAction(sessionId: string, action: DockerAction): Promise<DockerResult>;
  config(): Promise<Config>;
  systemFonts(): Promise<string[]>;
  presets(): Promise<WorkspacePreset[]>;
  savePreset(name: string, preferences: Preferences): Promise<void>;
  deletePreset(id: string): Promise<void>;
  exportPreset(preferences: Preferences): Promise<boolean>;
  importPreset(): Promise<WorkspacePreset | null>;
  mcpStatus(): Promise<McpStatus>;
  mcpConfigure(settings: McpSettings, expectedRevision: string): Promise<McpStatus>;
  mcpChooseFileRoot(): Promise<z.infer<typeof apiLocalFileRootSchema> | null>;
  mcpCopyToken(clientId?: string): Promise<void>;
  mcpRotateToken(clientId?: string): Promise<void>;
  importAppearance(kind: 'font' | 'background', token?: string): Promise<AppearanceAsset | null>;
  appearanceData(id: string): Promise<string>;
  saveProfile(profile: Profile): Promise<void>;
  moveProfile?(id: string, group: string, before?: string): Promise<void>;
  aiDrafts?(): Promise<Record<string, string>>;
  aiDraftSave?(id: string, text: string): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  manageGroup(action: GroupAction): Promise<void>;
  preferences(value: Preferences): Promise<void>;
  pickKey(): Promise<{ token: string; name: string } | null>;
  connect(
    profileId: string,
    credentials: Credentials,
    requestId?: string,
  ): Promise<{ sessionId: string }>;
  connectTemporary(
    profile: Profile,
    credentials: Credentials,
    requestId?: string,
  ): Promise<{ sessionId: string }>;
  cancelConnect(requestId: string): Promise<void>;
  disconnect(sessionId: string): Promise<void>;
  input(sessionId: string, data: string): Promise<void>;
  acknowledge(sessionId: string, characters: number): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  list(sessionId: string, path: string): Promise<{ path: string; entries: FileEntry[] }>;
  fileAction(
    sessionId: string,
    action: 'mkdir' | 'rename' | 'delete',
    path: string,
    destination?: string,
  ): Promise<void>;
  upload(sessionId: string, path: string, dropTokens?: string[]): Promise<void>;
  download(sessionId: string, paths: string[]): Promise<void>;
  cancelTransfer(id: string): Promise<void>;
  chooseLocal(): Promise<{ root: string; label: string } | null>;
  localList(root: string, path: string): Promise<{ path: string; entries: FileEntry[] }>;
  localAction(
    root: string,
    action: 'mkdir' | 'rename' | 'delete',
    path: string,
    destination?: string,
  ): Promise<void>;
  transferFiles(sources: FileRef[], target: FileRef, move: boolean): Promise<void>;
  monitor(sessionId: string): Promise<Metrics>;
  resourceHardware(sessionId: string): Promise<import('./resources').HardwareInfo>;
  resourceProcesses(sessionId: string): Promise<import('./resources').ProcessSnapshot>;
  droppedFiles(files: File[]): string[];
  copyText(text: string): Promise<void>;
  pasteText(): Promise<string>;
  events(listener: (event: SessionEvent) => void): () => void;
}
declare global {
  interface Window {
    cshell: Bridge;
  }
}

