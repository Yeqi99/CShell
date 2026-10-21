import { z } from 'zod';
import { createHash } from 'node:crypto';
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

const paymentSchema=z.object({
  kind:z.enum(['transfer','red_packet']),
  messageState:z.enum(['transfer_notice','red_packet_notice','receipt_notice','unknown']),
  paymentReference:z.string().regex(/^[a-f0-9]{64}$/),
  amountMinor:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  currency:z.literal('CNY').nullable(),
  settlementStatus:z.literal('unverified'),
});

/** Preserve message rules while deriving a separate, receipt-independent incoming notification. */
export function wechatAiEvents(notification:{id:string;accountId:string;event:unknown}):AiPluginEvent[]{
  const base=wechatAiEvent(notification);if(!base)return [];
  const raw=notification.event as Record<string,unknown>;
  const parsed=paymentSchema.safeParse(raw.payment);
  if(!parsed.success||base.isSelf||(!base.isGroup&&raw.recipientId!==notification.accountId)||(raw.nativeType as number)%2**32!==49||raw.format!=='payment-card')return [base];
  const payment=parsed.data;
  if((payment.kind==='transfer'&&payment.messageState!=='transfer_notice')||
     (payment.kind==='red_packet'&&payment.messageState!=='red_packet_notice'))return [base];
  // Card identity is shared with the payment toolkit, but no native tickets or claim actions are exposed.
  const amountKnown=payment.kind==='transfer'&&payment.currency==='CNY'&&payment.amountMinor!==null;
  return [base,{...base,id:payment.kind+':'+createHash('sha256').update(JSON.stringify([base.conversationId,payment.paymentReference])).digest('hex'),
    type:payment.kind==='transfer'?'transfer.received':'red_packet.received',
    payload:{messageId:base.payload.messageId,conversationId:base.conversationId,senderId:base.senderId,
      timestamp:base.occurredAt,paymentKind:payment.kind,paymentReference:payment.paymentReference,
      amountMinor:amountKnown?payment.amountMinor:null,currency:amountKnown?'CNY':null,
      amountStatus:amountKnown?'message_amount':'unknown',messageState:payment.messageState,settlementStatus:'unverified'}}];
}
