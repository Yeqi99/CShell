import type { AiAttachment } from '../shared/ai';

const imageTypes: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};
const textExtension = /\.(txt|md|markdown|rst|log|csv|tsv|jsonl?|jsonc|xml|html?|css|scss|less|[cm]?[jt]sx?|vue|svelte|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|lua|sql|sh|bash|zsh|ps1|bat|cmd|yaml|yml|toml|ini|conf|cfg|properties|env|gitignore|diff|patch)$/i;
const textName = /^(readme|license|dockerfile|makefile|gemfile)$/i;
const byteLimit = 8 * 1024 * 1024;

function mimeFor(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (Object.hasOwn(imageTypes, ext)) return imageTypes[ext];
  if (Object.values(imageTypes).includes(file.type)) return file.type;
  if (file.type.startsWith('text/') || textExtension.test(file.name) || textName.test(file.name)) return 'text/plain';
  throw Error(`暂不支持「${file.name}」的格式。可添加 PNG、JPEG、WebP、GIF 或 UTF-8 文本与代码文件。`);
}

export function validateComposerFiles(files: readonly File[]): void {
  if (files.length > 6) throw Error('每条消息最多添加 6 个附件。');
  if (files.reduce((sum, file) => sum + file.size, 0) > byteLimit) throw Error('这条消息的附件总大小超过 8 MiB。');
  for (const file of files) {
    if (!file.size) throw Error(`「${file.name}」是空文件。`);
    mimeFor(file);
  }
}

function encode(bytes: Uint8Array): string {
  // Multiples of three avoid padding between chunks.
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 24576) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576))));
  }
  return chunks.join('');
}

function imageMatches(bytes: Uint8Array, mime: string): boolean {
  const header = String.fromCharCode(...bytes.subarray(0, 12));
  switch (mime) {
    case 'image/png': return header.startsWith('\x89PNG\r\n\x1a\n');
    case 'image/jpeg': return header.startsWith('\xff\xd8\xff');
    case 'image/webp': return header.startsWith('RIFF') && header.slice(8) === 'WEBP';
    case 'image/gif': return header.startsWith('GIF87a') || header.startsWith('GIF89a');
    default: return false;
  }
}

export async function encodeComposerAttachments(files: readonly File[]): Promise<AiAttachment[]> {
  validateComposerFiles(files);
  const attachments: AiAttachment[] = [];
  for (const file of files) {
    const mime = mimeFor(file);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (mime === 'text/plain') {
      try {
        if (bytes.includes(0)) throw Error();
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw Error(`无法读取「${file.name}」，请另存为 UTF-8 文本后重试。`);
      }
    } else if (!imageMatches(bytes, mime)) {
      throw Error(`「${file.name}」的内容与图片格式不符，请重新导出图片。`);
    }
    attachments.push({ name: file.name, mime: mime as AiAttachment['mime'], data: encode(bytes) });
  }
  return attachments;
}
