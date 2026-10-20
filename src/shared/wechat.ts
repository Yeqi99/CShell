import { z } from 'zod';
export const wechatTargetSchema = z.string().regex(/^(wxid_[A-Za-z0-9_]{3,64}|[0-9]{5,32}@chatroom|filehelper)$/);
export const wechatFriendSchema = z.string().regex(/^wxid_[A-Za-z0-9_]{3,64}$/);
const targets = z.array(z.union([wechatTargetSchema,z.literal('*')])).max(100);
export const wechatConfigSchema = z.object({
  enabled: z.boolean(), experimental: z.boolean(), pid: z.number().int().positive().nullable(),
  sendFiles: z.boolean().default(false), publishMoments: z.boolean().default(false), readMoments: z.boolean().default(false), readSessions: z.boolean().default(false), readContacts: z.boolean(), send: targets, sendBlocked: z.array(wechatTargetSchema).max(100).default([]), receive: targets, history: targets.default([]),
  remarks: z.array(z.union([wechatFriendSchema,z.literal('*')])).max(100).default([]),
}).strict();
export type WechatConfig = z.infer<typeof wechatConfigSchema>;
export interface WechatBridge {
  wechatStatus(): Promise<{ config: WechatConfig; processes: { pid: number; version: string; binding: unknown }[]; error?: string; subscriptions?: {id:string;state:string;reason?:string}[] }>;
  wechatStopSubscriptions(): Promise<void>;
  onWechatEvent(listener:(event:{id:string;cursor:string})=>void):()=>void;
  wechatSave(config: WechatConfig): Promise<void>;
}
export const emptyWechatConfig = (): WechatConfig => ({enabled:false,experimental:false,pid:null,readContacts:false,readSessions:false,readMoments:false,publishMoments:false,sendFiles:false,send:[],sendBlocked:[],receive:[],history:[],remarks:[]});

export function parseWechatConfig(input: unknown): WechatConfig {
  const result = wechatConfigSchema.safeParse(input);
  if (result.success) return result.data;
  const field = String(result.error.issues[0]?.path[0] ?? '');
  const labels: Record<string,string> = {send:'发送授权',sendBlocked:'发送黑名单',receive:'接收授权',history:'历史授权',remarks:'备注授权'};
  if (labels[field]) {
    const hint = field === 'remarks' ? '请填写好友内部 ID（wxid_…）或 *。' : field === 'sendBlocked' ? '请填写准确内部 ID，黑名单不支持 *。' : '请填写内部 ID、群 ID、filehelper 或 *。';
    throw new Error(`${labels[field]}格式不正确（最多 100 项）。${hint}`);
  }
  throw new Error('微信设置格式不正确，请检查进程与开关。');
}
