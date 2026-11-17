import { z } from 'zod';

export const chatDocument = z.object({
  id:z.string().uuid(), title:z.string().max(200), target:z.string().max(300),
  messages:z.array(z.object({role:z.enum(['user','assistant']),text:z.string().max(200000)}).strict()).min(1).max(3000),
}).strict();
export type ChatDocument = z.infer<typeof chatDocument>;
export type ChatRecord = ChatDocument & {revision:number};
export type ChatShelf = {account:string;records:ChatRecord[]};
export const chatMutation = z.discriminatedUnion('action',[
  z.object({action:z.literal('list')}),
  z.object({action:z.literal('save'),account:z.string(),document:chatDocument,revision:z.number().int().nonnegative()}),
  z.object({action:z.literal('remove'),account:z.string(),id:z.string().uuid(),revision:z.number().int().positive()}),
]);
export type ChatCommand=z.infer<typeof chatMutation>;
export type ChatBridge=(command:ChatCommand)=>Promise<ChatShelf>;
export function extendsChat(local:ChatDocument, saved:ChatDocument) {
  return local.messages.length>=saved.messages.length && saved.messages.every((m,i)=>m.role===local.messages[i].role && m.text===local.messages[i].text);
}
