import { z } from 'zod';
export const wechatTargetSchema = z.string().regex(/^(wxid_[A-Za-z0-9_]{3,64}|[0-9]{5,32}@chatroom|filehelper)$/);
export const wechatConfigSchema = z.object({
  enabled: z.boolean(), experimental: z.boolean(), pid: z.number().int().positive().nullable(),
  readContacts: z.boolean(), send: z.array(z.union([wechatTargetSchema,z.literal('*')])).max(100), sendBlocked: z.array(wechatTargetSchema).max(100).default([]), receive: z.array(wechatTargetSchema).max(100), history: z.array(wechatTargetSchema).max(100).default([]),
  remarks: z.array(z.string().regex(/^wxid_[A-Za-z0-9_]{3,64}$/)).max(100).default([]),
}).strict();
export type WechatConfig = z.infer<typeof wechatConfigSchema>;
export interface WechatBridge {
  wechatStatus(): Promise<{ config: WechatConfig; processes: { pid: number; version: string; binding: unknown }[]; error?: string }>;
  wechatSave(config: WechatConfig): Promise<void>;
}
export const emptyWechatConfig = (): WechatConfig => ({enabled:false,experimental:false,pid:null,readContacts:false,send:[],sendBlocked:[],receive:[],history:[],remarks:[]});
