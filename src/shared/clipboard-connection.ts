import { extractConnectionByRules } from './connection-rules';

// Automatic detection is stricter than the explicit text extractor: a bare domain,
// email, web URL or arbitrary prose is not sufficient evidence of a connection.
export function detectClipboardConnection(text: string) {
  const value = text.trim();
  if (!value || value.length > 24000 || /\x00/.test(value)) return null;
  const explicit = /^(?:ssh\s|ssh:\/\/)/i.test(value);
  const labelled =
    /(?:^|\n)\s*(?:主机地址|服务器地址|服务器ip|ip地址|主机|ip|host|hostname)\s*[:：=]/i.test(
      value,
    ) &&
    /(?:^|[\s,，;；])(?:端口|port|用户名|用户|账号|账户|username|user|login)\s*[:：=]/i.test(value);
  if (!explicit && !labelled) return null;
  try {
    return extractConnectionByRules(value);
  } catch {
    return null;
  }
}

export async function clipboardDigest(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text.trim()),
  );
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}
