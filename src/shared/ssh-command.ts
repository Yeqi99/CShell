/** Parse a small, explicit SSH command subset. Never execute shell input. */
export function parseSshCommand(
  input: string,
): { host: string; username?: string; port: number } | null {
  const text = input.trim();
  if (!/^ssh\s/i.test(text)) return null;
  if (/[;&|`$<>\r\n]/.test(text)) throw new Error('Unsupported SSH command');
  const tokens = text.split(/\s+/).slice(1);
  let target = '',
    username: string | undefined,
    port = 22;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '-p' || token === '-l') {
      const value = tokens[++i];
      if (!value) throw new Error('Missing SSH option');
      if (token === '-p') {
        if (!/^\d+$/.test(value)) throw new Error('Invalid SSH port');
        port = Number(value);
      } else username = value;
    } else if (/^-p\d+$/.test(token)) port = Number(token.slice(2));
    else if (token.startsWith('-') || target) throw new Error('Unsupported SSH option');
    else target = token;
  }
  if (!target || port < 1 || port > 65535) throw new Error('Invalid SSH target');
  const at = target.lastIndexOf('@');
  if (at >= 0) {
    username ??= target.slice(0, at);
    target = target.slice(at + 1);
  }
  if (target.startsWith('[') && target.endsWith(']')) target = target.slice(1, -1);
  if (!target || (username !== undefined && !username) || /[\s'"@]/.test(target))
    throw new Error('Invalid SSH target');
  return { host: target, username, port };
}
