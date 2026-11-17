import type { BrowserEntry } from '../shared/machine-browser';
export function browserSuggestions(
  query: string,
  history: BrowserEntry[],
  bookmarks: BrowserEntry[],
) {
  const q = query.trim().toLowerCase(),
    seen = new Set<string>();
  return [...history, ...bookmarks]
    .filter((e) => {
      if (seen.has(e.url)) return false;
      seen.add(e.url);
      return !q || e.url.toLowerCase().includes(q) || e.title.toLowerCase().includes(q);
    })
    .slice(0, 8);
}
export function browserPagePermission(permission: string, active: boolean) {
  return active && ['clipboard-sanitized-write', 'fullscreen'].includes(permission);
}

export function storageAccessPair(page: string, frame: string) {
  try {
    const top = new URL(page), embedded = new URL(frame);
    if (top.protocol === 'https:' && embedded.protocol === 'https:' &&
        !top.username && !top.password && !embedded.username && !embedded.password) {
      return { top: top.origin, embedded: embedded.origin, key: JSON.stringify([top.origin, embedded.origin]) };
    }
  } catch { /* Opaque and missing origins cannot receive a grant. */ }
}
