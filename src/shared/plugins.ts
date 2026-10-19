import { z } from 'zod';

export const pluginId = z
  .string()
  .regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/)
  .max(100);
export const pluginManifestSchema = z
  .object({
    protocol: z.literal(1),
    id: pluginId,
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    name: z.string().min(1).max(80),
    description: z.string().max(300),
    descriptionEn: z.string().max(300).optional(),
    publisher: z.string().min(1).max(80),
    provider: z.enum([
      'vim',
      'nano',
      'commands',
      'docker',
      'conda',
      'python',
      'snippets',
      'wsl',
      'http',
      'agent',
      'wechat',
      'opencode',
      'tavily',
    ]),
    permissions: z
      .array(z.enum(['terminal.input', 'remote.read', 'remote.execute', 'remote.forward']))
      .max(4),
    commands: z
      .array(
        z
          .object({
            label: z.string().min(1).max(100),
            text: z
              .string()
              .min(1)
              .max(500)
              .refine((s) => !/[\x00-\x1f\x7f]/.test(s)),
          })
          .strict(),
      )
      .max(200)
      .default([]),
  })
  .strict();
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export const installedPluginSchema = z
  .object({ manifest: pluginManifestSchema, enabled: z.boolean(), source: z.string().max(2048) })
  .strict();
export type InstalledPlugin = z.infer<typeof installedPluginSchema>;
const builtin = (
  id: string,
  name: string,
  description: string,
  provider: PluginManifest['provider'],
  permissions: PluginManifest['permissions'],
): PluginManifest => ({
  protocol: 1,
  id: `cshell.${id}`,
  version: '1.0.0',
  name,
  description,
  descriptionEn: (
    {
      vim: 'Navigate, search, edit, save and exit Vim.',
      nano: 'Navigate, search, save and exit Nano.',
      commands: 'Complete common Linux commands without executing them.',
      docker: 'Containers, images, port mappings and live resources.',
      conda: 'Manage Conda environments, packages, terminals and Jupyter.',
      python: 'Interpreter-aware completion, signatures and syntax diagnostics.',
    } as Record<string, string>
  )[id],
  publisher: 'CShell',
  provider,
  permissions,
  commands: [],
});
export const builtinPlugins = [
  builtin('tavily', 'Tavily 搜索', '多 Key 用量管理，为智能体提供带来源的网络搜索。', 'tavily', []),
  builtin('opencode', 'OpenCode', '接入 Go 套餐或按量计费模型，选择模型并查看官方用量。', 'opencode', []),
  builtin('wechat', '微信（实验）', '绑定本机 Windows 微信，授权智能体读取联系人、收发文本。实验适配可能导致微信崩溃。', 'wechat', []),
  builtin('http', 'HTTP', '编辑请求、多目标、切换发送方与请求历史，可供智能体调用。', 'http', [
    'remote.forward',
  ]),
  builtin('agent', 'CAgent', '配置此电脑的受控访问、监听地址与权限。', 'agent', [
    'remote.execute',
    'remote.forward',
  ]),
  builtin('wsl', 'WSL Linux', '发现本机 Linux 发行版，在标签中打开 WSL 终端。', 'wsl', [
    'terminal.input',
  ]),
  builtin('vim', 'Vim', '模式切换、定位、搜索、保存与退出。', 'vim', ['terminal.input']),
  builtin('nano', 'Nano', '定位、搜索、保存与退出。', 'nano', ['terminal.input']),
  builtin('commands', 'Shell', 'Linux 常用命令联想，只补全，不自动执行。', 'commands', [
    'terminal.input',
  ]),
  builtin('docker', 'Docker', '容器、镜像、端口映射与实时资源。', 'docker', [
    'remote.read',
    'remote.execute',
  ]),
  builtin('conda', 'Anaconda', '识别 Conda 环境，管理依赖，打开环境终端与 Jupyter。', 'conda', [
    'remote.read',
    'remote.execute',
    'remote.forward',
  ]),
  builtin('python', 'Python', '基于当前解释器的补全、签名与语法诊断。', 'python', [
    'remote.read',
    'remote.execute',
  ]),
];
export function initialPlugins(docker = false, commands = true): InstalledPlugin[] {
  return builtinPlugins
    .filter(
      (p) =>
        ['vim', 'nano', 'commands'].includes(p.provider) || (p.provider === 'docker' && docker),
    )
    .map((manifest) => ({
      manifest,
      enabled: manifest.provider !== 'commands' || commands,
      source: 'bundled',
    }));
}
export const pluginEnabled = (plugins: InstalledPlugin[], provider: PluginManifest['provider']) =>
  plugins.some((p) => p.enabled && p.manifest.provider === provider);
export const catalogSchema = z
  .object({
    protocol: z.literal(1),
    plugins: z
      .array(
        z
          .object({
            manifest: pluginManifestSchema,
            url: z.url().startsWith('https://'),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type CatalogEntry = z.infer<typeof catalogSchema>['plugins'][number];
export interface RemoteEnvironment {
  prefix: string;
  python: string;
  name: string;
}
export interface EnvironmentSnapshot {
  conda: string | null;
  environments: RemoteEnvironment[];
  python: string | null;
}
export const remoteExecutable = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => p.startsWith('/') && !/[\x00-\x1f\x7f]/.test(p));
export const environmentActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('create'),
      conda: remoteExecutable,
      name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
      version: z.enum(['3.11', '3.12', '3.13', '3.14']),
    })
    .strict(),
  z
    .object({ type: z.literal('remove'), conda: remoteExecutable, prefix: remoteExecutable })
    .strict(),
  z
    .object({
      type: z.literal('install'),
      python: remoteExecutable,
      packages: z
        .array(
          z
            .string()
            .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*(?:==[a-zA-Z0-9_.+-]+)?$/)
            .max(150),
        )
        .min(1)
        .max(30),
    })
    .strict(),
]);
export type EnvironmentAction = z.infer<typeof environmentActionSchema>;
export interface RemoteJob {
  id: string;
  sessionId: string;
  label: string;
  state: 'running' | 'succeeded' | 'failed' | 'cancelled';
  output: string;
  started: number;
}
export const applicationId = z.enum([
  'miniconda',
  'anaconda',
  'python',
  'jupyter',
  'jedi',
  'nginx',
  'redis',
]);
export type ApplicationId = z.infer<typeof applicationId>;
export const applications: { id: ApplicationId; name: string; description: string }[] = [
  { id: 'miniconda', name: 'Miniconda', description: '轻量 Conda 与 Python，安装到当前用户目录。' },
  {
    id: 'anaconda',
    name: 'Anaconda Distribution',
    description: '包含数据科学工具的完整 Python 发行版。',
  },
  { id: 'python', name: 'Python', description: '在 Conda 中创建独立 Python 环境。' },
  { id: 'jupyter', name: 'JupyterLab', description: '安装到所选环境，通过 SSH 隧道打开。' },
  { id: 'jedi', name: 'Python 补全引擎', description: '为所选 Python 环境安装 Jedi 语义分析。' },
  { id: 'nginx', name: 'Nginx', description: '安装发行版提供的 Web 服务。需要服务器管理员身份。' },
  {
    id: 'redis',
    name: 'Redis',
    description: '安装发行版提供的 Redis 服务。需要服务器管理员身份。',
  },
];
export const applicationRequestSchema = z
  .object({
    app: applicationId,
    python: remoteExecutable.optional(),
    conda: remoteExecutable.optional(),
    version: z.enum(['3.11', '3.12', '3.13', '3.14']).default('3.12'),
    name: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
      .default('cshell-python'),
  })
  .strict();
export type ApplicationRequest = z.infer<typeof applicationRequestSchema>;
export interface InstallationPlan {
  id: string;
  sessionId: string;
  app: ApplicationId;
  label: string;
  command: string;
  expires: number;
}
export interface PythonAnalysis {
  completions: { label: string; detail: string; type: string }[];
  signatures: string[];
  diagnostics: {
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
    message: string;
  }[];
}
export interface ExtensionBridge {
  applicationCatalog(): Promise<typeof applications>;
  pythonReadFile(sessionId: string, path: string): Promise<{ code: string; revision: string }>;
  pythonSaveFile(
    sessionId: string,
    path: string,
    code: string,
    revision: string,
  ): Promise<{ revision: string }>;
  plugins(): Promise<InstalledPlugin[]>;
  pluginInstall(id: string): Promise<void>;
  pluginToggle(id: string, enabled: boolean): Promise<void>;
  pluginRemove(id: string): Promise<void>;
  pluginSource(): Promise<{ url: string; entries: CatalogEntry[] } | null>;
  pluginCatalog(url: string): Promise<CatalogEntry[]>;
  pluginDownload(entry: CatalogEntry): Promise<void>;
  environments(sessionId: string): Promise<EnvironmentSnapshot>;
  environmentAction(sessionId: string, action: EnvironmentAction): Promise<RemoteJob>;
  environmentTerminal(
    sessionId: string,
    conda: string,
    prefix: string,
  ): Promise<{ sessionId: string }>;
  environmentPackages(
    sessionId: string,
    python: string,
  ): Promise<{ name: string; version: string }[]>;
  pythonAnalyze(
    sessionId: string,
    python: string,
    code: string,
    line: number,
    column: number,
    path?: string,
  ): Promise<PythonAnalysis>;
  applicationPlan(sessionId: string, request: ApplicationRequest): Promise<InstallationPlan>;
  applicationInstall(planId: string): Promise<RemoteJob>;
  jobs(sessionId: string): Promise<RemoteJob[]>;
  cancelJob(id: string): Promise<void>;
  jupyterStatus(sessionId: string, python: string): Promise<{ running: boolean; port?: number }>;
  jupyterStart(sessionId: string, python: string, port: number): Promise<void>;
  jupyterStop(sessionId: string, python: string): Promise<void>;
}
