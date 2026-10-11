export const shortcuts = [
  { id: 'palette', key: 'p', shift: true, label: 'Ctrl+Shift+P' },
  { id: 'new', key: 'n', shift: true, label: 'Ctrl+Shift+N' },
  { id: 'search', key: 'f', shift: true, label: 'Ctrl+Shift+F' },
  { id: 'settings', key: ',', shift: false, label: 'Ctrl+,' },
  { id: 'sidebar', key: 'b', shift: true, label: 'Ctrl+Shift+B' },
  { id: 'tools', key: 'e', shift: true, label: 'Ctrl+Shift+E' },
  { id: 'nextTab', key: 'tab', shift: false, label: 'Ctrl+Tab' },
  { id: 'previousTab', key: 'tab', shift: true, label: 'Ctrl+Shift+Tab' },
] as const;
export function shortcutFor(event: KeyboardEvent) {
  return shortcuts.find(
    (s) =>
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      event.shiftKey === s.shift &&
      event.key.toLowerCase() === s.key,
  )?.id;
}
