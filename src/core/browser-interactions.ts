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
