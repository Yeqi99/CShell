import type { Session, WebContents } from 'electron';

// Keep browser permissions denied except fullscreen from our own main document.
export function installWindowPermissions(session: Session, contents: WebContents, entry: string) {
  const trusted = (wc: WebContents | null, permission: string, url: string, main: boolean) =>
    wc === contents && permission === 'fullscreen' && main &&
    url.split('#')[0] === entry && contents.getURL().split('#')[0] === entry;
  session.setPermissionRequestHandler((wc, permission, callback, details) =>
    callback(trusted(wc, permission, details.requestingUrl, details.isMainFrame)));
  session.setPermissionCheckHandler((wc, permission, _origin, details) =>
    trusted(wc, permission, details.requestingUrl ?? '', details.isMainFrame));
}
