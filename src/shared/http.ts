import { z } from 'zod';

export const httpToolNames = [
  'http_list',
  'http_save_request',
  'http_send',
  'http_history',
] as const;
export const httpToolLabels = {
  http_list: '查看 HTTP 工作区、目标与发送方',
  http_save_request: '创建与修改已保存请求',
  http_send: '发送 HTTP 请求',
  http_history: '查看请求历史与响应',
};
export const httpUrl = z
  .string()
  .max(8192)
  .refine((v) => {
    try {
      const u = new URL(v);
      return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.hash;
    } catch {
      return false;
    }
  }, '请输入不含账号密码或片段的 HTTP / HTTPS 地址');
export const httpPairSchema = z
  .object({ enabled: z.boolean(), name: z.string().max(256), value: z.string().max(16000) })
  .strict();
export const httpRequestSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
    targetId: z.string().uuid().optional(),
    path: z.string().max(8192),
    query: z.array(httpPairSchema).max(100),
    headers: z.array(httpPairSchema).max(100),
    body: z.string().max(65536),
    bodyType: z.enum(['none', 'json', 'text', 'form']),
    sender: z.string().max(100),
    timeoutMs: z.number().int().min(1000).max(60000),
  })
  .strict();
export type HttpRequest = z.infer<typeof httpRequestSchema>;
export const httpWorkspaceSchema = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    targets: z
      .array(
        z
          .object({ id: z.string().uuid(), name: z.string().min(1).max(100), url: httpUrl })
          .strict(),
      )
      .max(100),
    requests: z.array(httpRequestSchema).max(200),
    tools: z.array(z.enum(httpToolNames)).max(4),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const rows of [v.targets, v.requests])
      if (new Set(rows.map((x) => x.id)).size !== rows.length)
        ctx.addIssue({ code: 'custom', message: '重复的记录 ID' });
  });
export type HttpWorkspace = z.infer<typeof httpWorkspaceSchema>;
export const httpWireSchema = z
  .object({
    url: httpUrl,
    method: httpRequestSchema.shape.method,
    headers: z.array(httpPairSchema).max(100),
    body: z.string().max(65536),
    timeoutMs: httpRequestSchema.shape.timeoutMs,
  })
  .strict();
export type HttpWireRequest = z.infer<typeof httpWireSchema>;
export const httpResponseSchema = z.object({
  status: z.number().int(),
  statusText: z.string(),
  headers: z.array(z.tuple([z.string(), z.string()])),
  body: z.string().max(3_000_000),
  bytes: z.number(),
  elapsedMs: z.number(),
  truncated: z.boolean(),
});
export type HttpResponse = z.infer<typeof httpResponseSchema>;
export type HttpHistory = {
  id: string;
  workspaceId: string;
  request: HttpRequest;
  url: string;
  senderLabel: string;
  source: 'user' | 'agent';
  time: number;
  state: 'running' | 'done' | 'failed' | 'cancelled';
  response?: HttpResponse;
  error?: string;
};
export type HttpSender = {
  id: string;
  name: string;
  available: boolean;
  reason?: string;
  sessionId?: string;
  identity?: string;
};
export const newHttpRequest = (): HttpRequest => ({
  id: crypto.randomUUID(),
  name: '新请求',
  method: 'GET',
  path: '/',
  query: [],
  headers: [],
  body: '',
  bodyType: 'none',
  sender: 'local',
  timeoutMs: 15000,
});
export interface HttpBridge {
  httpCreate(name: string, group: string): Promise<string>;
  httpWorkspace(id: string): Promise<HttpWorkspace>;
  httpSave(workspace: HttpWorkspace): Promise<HttpWorkspace>;
  httpSenders(): Promise<HttpSender[]>;
  httpSend(id: string, request: HttpRequest, runId: string): Promise<HttpHistory>;
  httpHistory(id: string): Promise<HttpHistory[]>;
  httpCancel(runId: string): Promise<void>;
  onHttpChanged(listener: (id: string) => void): () => void;
}
