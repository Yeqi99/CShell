import type { Session, WebContents } from 'electron';

// Keep browser permissions denied except fullscreen from our own main document.
const documents = new WeakMap<Session, Map<WebContents, string>>();
export function installWindowPermissions(session: Session, contents: WebContents, entry: string) {
  const entries = documents.get(session) ?? new Map<WebContents, string>();
  documents.set(session, entries);
  entries.set(contents, entry);
  contents.once('destroyed', () => entries.delete(contents));
  const trusted = (wc: WebContents | null, permission: string, url: string, main: boolean) =>
    !!wc && entries.has(wc) && permission === 'fullscreen' && main &&
    url.split('#')[0] === entries.get(wc) && wc.getURL().split('#')[0] === entries.get(wc);
  session.setPermissionRequestHandler((wc, permission, callback, details) =>
    callback(trusted(wc, permission, details.requestingUrl, details.isMainFrame)));
  session.setPermissionCheckHandler((wc, permission, _origin, details) =>
    trusted(wc, permission, details.requestingUrl ?? '', details.isMainFrame));
}
