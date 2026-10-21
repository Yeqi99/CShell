import { z } from 'zod';
export const codingEngine = z.enum(['codex', 'claude']);
export const codingProfileSchema = z
  .object({
    id: z.string().uuid(),
    engine: codingEngine,
    name: z.string().trim().min(1).max(80),
    auth: z.enum(['official', 'api']),
    endpoint: z.string().max(2048).default(''),
    model: z.string().max(160).default(''),
    key: z.string().max(16000).optional(),
  })
  .strict()
  .superRefine((p, c) => {
    if (p.auth === 'api') {
      try {
        const u = new URL(p.endpoint);
        if (
          u.username ||
          u.password ||
          u.hash ||
          !(
            u.protocol === 'https:' ||
            (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
          )
        )
          throw Error();
      } catch {
        c.addIssue({ code: 'custom', message: 'API 地址须为 HTTPS，或服务器本机 HTTP' });
      }
      if (!p.model) c.addIssue({ code: 'custom', message: '请填写模型名称' });
    }
  });
export type CodingProfile = z.infer<typeof codingProfileSchema>;
export type CodingEngine = z.infer<typeof codingEngine>;
export type CodingTask = {
  id: string;
  owner: string;
  engine: CodingEngine;
  profileId: string;
  profileName: string;
  profileBinding?: string;
  cwd: string;
  title: string;
  state: 'stopping' | 'running' | 'approval' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  messages: { role: 'user' | 'assistant'; text: string }[];
  events: { kind: string; text: string }[];
  threadId?: string;
  error?: string;
  createdAt: string;
  approval?: { id: string; method: string; details: unknown };
};
export const codingMethods = [
  'coding.status',
  'coding.configure',
  'coding.profile.save',
  'coding.profile.remove',
  'coding.install.plan',
  'coding.install',
  'coding.install.cancel',
  'coding.start',
  'coding.tasks',
  'coding.task',
  'coding.stop',
  'coding.approve',
  'coding.login',
  'coding.login.status',
  'coding.login.input',
  'coding.login.cancel',
] as const;
