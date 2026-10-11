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
    name: text,
    host: text,
    port: z.number().int().min(1).max(65535),
    username: text,
    group: z.string().trim().max(100),
    favorite: z.boolean(),
    auth: z.enum(['password', 'key']),
  })
  .strict();
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
  })
  .strict();
export const mcpSettingsSchema = z
  .object({
    enabled: z.boolean(),
    port: z.number().int().min(1024).max(65535),
    allowedProfiles: z.array(z.string().uuid()).max(1000),
    allowCommands: z.boolean(),
  })
  .strict();
export type McpSettings = z.infer<typeof mcpSettingsSchema>;
export interface McpStatus {
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
    }),
    locale: z.enum(['zh-CN', 'en-US']),
    theme: z.enum(['dark', 'light']),
    uiFont: z.string().max(200),
    terminalFont: z.string().max(200),
    fontSize: z.number().min(10).max(28),
    lineHeight: z.number().min(1).max(1.8).default(1.2),
    uiFontAsset: appearanceAssetSchema.nullable().default(null),
    terminalFontAsset: appearanceAssetSchema.nullable().default(null),
    backgroundAsset: appearanceAssetSchema.nullable().default(null),
    backgroundOpacity: z.number().min(0).max(0.5).default(0.15),
    backgroundBlur: z.number().min(0).max(20).default(0),
    backgroundFit: z.enum(['cover', 'contain']).default('cover'),
  })
  .strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaults: Preferences = {
  layout: {
    order: ['servers', 'terminal', 'files'],
    serverVisible: true,
    fileVisible: true,
    serverWidth: 218,
    fileWidth: 340,
  },
  locale: 'zh-CN',
  theme: 'light',
  uiFont: 'Segoe UI, Microsoft YaHei UI, sans-serif',
  terminalFont: 'Cascadia Code, Consolas, Microsoft YaHei UI, monospace',
  fontSize: 14,
  lineHeight: 1.2,
  uiFontAsset: null,
  terminalFontAsset: null,
  backgroundAsset: null,
  backgroundOpacity: 0.15,
  backgroundBlur: 0,
  backgroundFit: 'cover',
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
  | { type: 'data'; sessionId: string; data: string }
  | { type: 'closed'; sessionId: string; error?: string }
  | { type: 'transfer'; transfer: Transfer };
export interface Bridge extends ExtensionBridge, AiBridge, UpdateBridge {
  setAlwaysOnTop(enabled: boolean): Promise<boolean>;
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
  mcpConfigure(settings: McpSettings): Promise<McpStatus>;
  mcpCopyToken(): Promise<void>;
  mcpRotateToken(): Promise<void>;
  importAppearance(kind: 'font' | 'background', token?: string): Promise<AppearanceAsset | null>;
  appearanceData(id: string): Promise<string>;
  saveProfile(profile: Profile): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  manageGroup(action: GroupAction): Promise<void>;
  preferences(value: Preferences): Promise<void>;
  pickKey(): Promise<{ token: string; name: string } | null>;
  connect(profileId: string, credentials: Credentials): Promise<{ sessionId: string }>;
  connectTemporary(profile: Profile, credentials: Credentials): Promise<{ sessionId: string }>;
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
