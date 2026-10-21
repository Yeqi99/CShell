import type { MonitorView } from './monitor-views';

/** Merge one display's edits without restoring removed panes or changing other displays. */
export function mergeMonitorDisplay(saved: MonitorView, edited: MonitorView, ownedIds: ReadonlySet<string>, displayId?: string): MonitorView {
  const changes = new Map(edited.tiles.map(tile => [tile.id, tile]));
  return { ...saved, mode: edited.mode, tiles: saved.tiles.flatMap(tile => {
    if (!ownedIds.has(tile.id)) return [tile];
    const changed = changes.get(tile.id);
    if (!changed) return [];
    return [{ ...tile, column: changed.column, row: changed.row, width: changed.width,
      height: changed.height, displayId: displayId ?? changed.displayId }];
  }) };
}
