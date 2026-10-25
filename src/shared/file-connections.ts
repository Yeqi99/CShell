import type { Profile } from './contracts';

export type FileProtocol = 'sftp' | 'ftp' | 'ftps';
export function isFileConnection(profile: Pick<Profile, 'protocol'>): boolean {
  return profile.protocol === 'sftp' || profile.protocol === 'ftp' || profile.protocol === 'ftps';
}
export function profileProvider(profile: Pick<Profile, 'protocol'>): string {
  if (profile.protocol === 'sftp') return 'cshell.sftp';
  if (profile.protocol === 'ftp' || profile.protocol === 'ftps') return 'cshell.ftp';
  if (!profile.protocol || profile.protocol === 'ssh') return 'cshell.ssh';
  throw new Error('This connection requires its own provider');
}
