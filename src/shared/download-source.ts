/** Public download traffic stays on the Hong Kong origin, including metadata. */
export const downloadOrigin = 'https://shell.canp.ai';
export const downloadRoot = downloadOrigin + '/downloads/opensource';
export const downloadManifest = downloadRoot + '/releases.json';
export const downloadPage = downloadOrigin + '/';
export function trustedDownload(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === downloadOrigin && parsed.pathname.startsWith('/downloads/') && !parsed.username && !parsed.password && !parsed.hash && !parsed.search;
  } catch { return false; }
}
