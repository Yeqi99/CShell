import { z } from 'zod';

export const hostingRouteSchema = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
    path: z
      .string()
      .min(1)
      .max(2048)
      .regex(/^\/[^?#]*$/),
    mode: z.enum(['fixed', 'callback', 'code']).default('fixed'),
    status: z.number().int().min(200).max(599).default(200),
    headers: z.record(z.string(), z.string().max(4096)).default({}),
    body: z.string().max(65536).default(''),
    code: z.string().max(65536).optional(),
  })
  .strict()
  .superRefine((route, ctx) => {
    if (route.mode === 'code' && !route.code?.trim())
      ctx.addIssue({ code: 'custom', message: '代码路由需要代码' });
    if (Object.keys(route.headers).length > 32)
      ctx.addIssue({ code: 'custom', message: '响应头最多 32 项' });
    for (const [name, value] of Object.entries(route.headers)) {
      if (
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
        /[\r\n\x00]/.test(value) ||
        /^(connection|transfer-encoding|content-length|upgrade)$/i.test(name)
      ) {
        ctx.addIssue({ code: 'custom', message: '响应头无效或由服务管理' });
      }
    }
  });
export const hostingConfigSchema = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().nonnegative().default(0),
    name: z.string().trim().min(1).max(100),
    host: z.union([z.ipv4(), z.ipv6()]).default('127.0.0.1'),
    port: z.number().int().min(0).max(65535).default(0),
    allowExternal: z.boolean().default(false),
    routes: z.array(hostingRouteSchema).min(1).max(100),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(config)).byteLength > 65536)
      ctx.addIssue({ code: 'custom', message: '单个服务配置最多 64 KiB' });
    if (!config.allowExternal && config.host !== '127.0.0.1' && config.host !== '::1')
      ctx.addIssue({ code: 'custom', message: '对外监听需要明确允许' });
    const keys = config.routes.map((r) => `${r.method} ${r.path}`);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: 'custom', message: '请求方法和路径不能重复' });
  });
export type HostingConfig = z.infer<typeof hostingConfigSchema>;
export interface HostingStatus {
  config: HostingConfig;
  running: boolean;
  actualPort?: number;
  error?: string;
  environment: 'windows' | 'linux' | 'darwin';
}
export interface HostingLog {
  time: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  body?: string;
  truncated?: boolean;
  error?: string;
}
export interface HostingStartOptions {
  expectedRevision: number;
  allowCode?: boolean;
}
