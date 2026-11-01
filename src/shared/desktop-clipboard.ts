import {z} from 'zod';
export const desktopClipboardRequestSchema=z.object({id:z.string().regex(/^[a-f0-9]{32}$/),action:z.enum(['sequence','read','readChunk','writeBegin','writeChunk','writeCommit','fileRead','fileBegin','fileChunk','filesCommit']),token:z.string().uuid().optional(),kind:z.enum(['text','png']).optional(),size:z.number().int().min(0).max(512*1024*1024).optional(),fileToken:z.string().uuid().optional(),fileTokens:z.array(z.string().uuid()).max(64).optional(),name:z.string().min(1).max(200).optional(),offset:z.number().int().min(0).optional(),data:z.string().max(88000).optional()}).strict();
export type DesktopClipboardRequest=z.infer<typeof desktopClipboardRequestSchema>;

