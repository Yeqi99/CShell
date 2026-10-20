import { z } from 'zod';
import type { TerminalSnapshot } from './floating';

export const viewTileSchema = z.object({
  id: z.string().uuid(),
  profileId: z.string().uuid(),
  label: z.string().trim().min(1).max(80),
  kind: z.enum(['ssh', 'desktop', 'client-terminal', 'local']),
  shell: z.enum(['cmd','powershell','sh']).optional(),
  displayId: z.string().max(100),
  column: z.number().int().min(0).max(11),
  row: z.number().int().min(0).max(11),
  width: z.number().int().min(1).max(12),
  height: z.number().int().min(1).max(12),
  directory: z.string().max(4096).default(''),
  command: z.string().max(8192).default(''),
  screen: z.string().max(128).default(''),
}).strict().refine(t => t.column + t.width <= 12 && t.row + t.height <= 12, '区域超出布局');
export const monitorViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  mode: z.enum(['tile', 'focus', 'overview']).optional(),
  tiles: z.array(viewTileSchema).max(96),
}).strict().superRefine((v, ctx) => {
  const ids = new Set<string>();
  for (let i = 0; i < v.tiles.length; i++) {
    const t = v.tiles[i];
    if (ids.has(t.id)) ctx.addIssue({ code: 'custom', message: '区域 ID 重复' });
    ids.add(t.id);
    for (const other of v.tiles.slice(0, i))
      if (other.displayId === t.displayId && t.column < other.column + other.width &&
        other.column < t.column + t.width && t.row < other.row + other.height && other.row < t.row + t.height)
        ctx.addIssue({ code: 'custom', message: `区域“${t.label}”与“${other.label}”重叠，请重新排列` });
  }
});
export type ViewTile = z.infer<typeof viewTileSchema>;
export type MonitorView = z.infer<typeof monitorViewSchema>;
export type CurrentViewSource = { kind: 'ssh' | 'terminal'; sessionId: string; snapshot: TerminalSnapshot } | { kind: 'desktop'; profileId: string };
export type BorrowedViewTerminal = { sessionId: string; snapshot: TerminalSnapshot };
export type ViewDisplay = { id: string; label: string; width: number; height: number; primary: boolean };
export interface MonitorViewsBridge {
  monitorViews(): Promise<MonitorView[]>;
  saveMonitorView(view: MonitorView): Promise<void>;
  deleteMonitorView(id: string): Promise<void>;
  viewDisplays(): Promise<ViewDisplay[]>;
  openMonitorView(id: string): Promise<void>;
  openCurrentView(sources: CurrentViewSource[], mode: 'tile' | 'focus' | 'overview'): Promise<void>;
  closeMonitorView(id: string): Promise<void>;
  monitorViewInit(): Promise<{ view: MonitorView; displayId: string; borrowed?: Record<string, BorrowedViewTerminal>; profiles?: import('./contracts').Profile[] }>;
}
export function arrangeViewTiles(tiles: ViewTile[], mode: 'grid' | 'rows' | 'focus'): ViewTile[] {
  const count = tiles.length;
  if (!count) return [];
  if (count > 12) throw new Error('每个屏幕最多排列 12 个区域，请分配到其他显示器');
  if (mode === 'focus' && count > 1) {
    return tiles.map((t, i) => i === 0 ? { ...t, column: 0, row: 0, width: 8, height: 12 } :
      { ...t, column: 8, row: Math.floor((i - 1) * 12 / (count - 1)), width: 4,
        height: Math.floor(i * 12 / (count - 1)) - Math.floor((i - 1) * 12 / (count - 1)) });
  }
  const cols = mode === 'rows' ? 1 : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return tiles.map((t, i) => {
    const x = i % cols, y = Math.floor(i / cols);
    const rowCols = Math.min(cols, count - y * cols);
    return { ...t, column: Math.floor(x * 12 / rowCols), row: Math.floor(y * 12 / rows),
      width: Math.floor((x + 1) * 12 / rowCols) - Math.floor(x * 12 / rowCols),
      height: Math.floor((y + 1) * 12 / rows) - Math.floor(y * 12 / rows) };
  });
}
export function viewShellCommand(tile: ViewTile): string {
  const quote = (v: string) => "'" + v.replace(/'/g, "'\\''") + "'";
  if (tile.screen) return `screen -x ${quote(tile.screen)}`;
  return (tile.directory ? `cd -- ${quote(tile.directory)} && ` : '') + (tile.command || 'pwd');
}

export const localViewProfiles: import('./contracts').Profile[] = ['cmd','powershell'].map((shell,i)=>({id:'00000000-0000-4000-8000-00000000000'+(i+1),name:shell==='cmd'?'本机 CMD':'本机 PowerShell',host:'localhost',port:1,username:'local',group:'',favorite:false,auth:'password'}));
