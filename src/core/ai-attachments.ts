import { z } from 'zod';
import type { AiAttachment } from '../shared/ai';

const maxBytes = 8 * 1024 * 1024;
const attachment = z.object({
  name: z.string().min(1).max(255).regex(/^[^\x00-\x1f\x7f]+$/),
  mime: z.enum(['text/plain','image/png','image/jpeg','image/webp','image/gif']),
  data: z.string().max(4 * Math.ceil(maxBytes / 3)),
}).strict();

export function parseAttachments(raw: unknown): AiAttachment[] {
  const files = z.array(attachment).max(6).parse(raw === undefined ? [] : raw);
  let total = 0;
  for (const file of files) {
    const bytes = Buffer.from(file.data,'base64');
    if (bytes.toString('base64') !== file.data) throw Error('附件编码无效');
    total += bytes.length;
    if (total > maxBytes) throw Error('附件总大小超过 8 MiB');
    if (file.mime === 'text/plain') new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  return files;
}

export function attachmentContent(prompt:string, files:AiAttachment[], imageInput?:boolean) {
  const parts: any[] = [{type:'text',text:prompt}];
  for (const file of files) {
    if (file.mime === 'text/plain') {
      parts.push({type:'text',text:JSON.stringify({filename:file.name,content:Buffer.from(file.data,'base64').toString('utf8')})});
    } else {
      if (imageInput === false) throw Error('当前模型不支持图片，请切换支持图片的模型');
      parts.push({type:'image_url',image_url:{url:'data:'+file.mime+';base64,'+file.data}});
    }
  }
  return files.every(file=>file.mime==='text/plain') ? parts.map(part=>part.text).join('\n\n') : parts;
}
