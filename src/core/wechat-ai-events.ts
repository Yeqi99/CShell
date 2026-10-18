import { z } from 'zod';
import type { AiPluginEvent } from '../shared/ai-events';
const message = z.object({
  kind:z.literal('message'),messageId:z.string().regex(/^[1-9][0-9]{0,19}$/),
  senderId:z.string().min(1).max(100),recipientId:z.string().min(1).max(100),
  conversationId:z.string().min(1).max(100),conversationType:z.enum(['private','group']),
  nativeType:z.number().int().nonnegative(),timestampRaw:z.union([z.string().regex(/^\d{1,12}$/),z.number().int().nonnegative()]),
  text:z.string().max(8000).nullable().optional(),format:z.string().max(40).optional(),
});
export function wechatAiEvent(notification:{id:string;accountId:string;event:unknown}):AiPluginEvent|null{
  const parsed=message.safeParse(notification.event);if(!parsed.success)return null;
  const v=parsed.data;
  // Do not pass raw protocol fields, credentials or unrelated account metadata to models.
  return {id:v.conversationId+':'+v.messageId,source:'wechat',type:'message.received',subscriptionId:notification.id,
    accountId:notification.accountId,senderId:v.senderId,conversationId:v.conversationId,
    isSelf:v.senderId===notification.accountId,isGroup:v.conversationType==='group',occurredAt:Number(v.timestampRaw)*1000,
    payload:{messageId:v.messageId,conversationId:v.conversationId,senderId:v.senderId,messageType:v.nativeType,
      text:v.format==='text'&&v.nativeType===1?v.text??'':null,contentStatus:v.format==='text'&&v.nativeType===1?'text':'unsupported',timestamp:Number(v.timestampRaw)*1000}};
}
