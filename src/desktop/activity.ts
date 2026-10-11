import { dialog, type BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { ActivityStore, exportActivity } from '../core/activity';
export function registerActivity(
  handle: (name: string, fn: (...args: any[]) => any) => void,
  window: BrowserWindow,
  store: ActivityStore,
) {
  handle('activity:snapshot', () => store.snapshot());
  handle('activity:enable', (enabled) => store.enable(enabled));
  handle('activity:clear', async () => {
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      message: '清空此设备的统计与操作记录？',
      detail: '连接配置、文件和会话不会被删除。',
      buttons: ['取消', '清空记录'],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response !== 1) return false;
    await store.clear();
    return true;
  });
  handle('activity:export', async (from, to, format) => {
    z.number().finite().parse(from);
    z.number().finite().parse(to);
    z.enum(['csv', 'html']).parse(format);
    if (from > to) throw Error('Invalid date range');
    const result = await dialog.showSaveDialog(window, {
      defaultPath: `CShell-activity.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(
      result.filePath,
      exportActivity(
        store.snapshot().events.filter((e) => e.time >= from && e.time <= to),
        format,
      ),
    );
    return true;
  });
}
