import { posix, win32 } from 'node:path';
export function remotePath(value: string) {
  if (!value || value.length > 4096 || /[\0\r\n]/.test(value))
    throw new Error('Invalid remote path');
  return value;
}
// A server controls directory entry names: never let them escape a local download root.
export function safeName(value: string) {
  if (
    !value ||
    value === '.' ||
    value === '..' ||
    /[\\/\0<>:"|?*]/.test(value) ||
    /[. ]$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) ||
    win32.isAbsolute(value)
  )
    throw new Error('Unsafe filename from server');
  return value;
}
export function childPath(parent: string, name: string) {
  if (!name || name === '.' || name === '..' || /[\/\0]/.test(name))
    throw new Error('Invalid filename');
  return posix.join(remotePath(parent), name);
}
