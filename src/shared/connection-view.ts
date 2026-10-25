import type { Preferences, Profile } from './contracts';

/** SFTP and HTTP remain purpose-specific workspaces, independent of machine desktop defaults. */
export function connectionUsesVisual(profile: Profile, preferences: Pick<Preferences, 'defaultConnectionView'>): boolean {
  if (['http', 'ftp', 'ftps', 'sftp'].includes(profile.protocol ?? 'ssh')) return false;
  if (profile.protocol === 'client') return true;
  return (profile.defaultConnectionView ?? preferences.defaultConnectionView) === 'visual';
}
