import { dialog, type BrowserWindow } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { ConnectionImport } from '../core/connection-import';
import type { Store } from '../core/store';
export function registerConnectionImport(handle: (name: string, fn: (...args: any[]) => any) => void, window: BrowserWindow, store: Store) {
  const service = new ConnectionImport(store);
  handle('connections:import-text', text => service.prepare(z.string().max(2 * 1024 * 1024).parse(text), 'text'));
  handle('connections:import-file', async delimiter => {
    const separator = z.enum([',', ';', '\t']).parse(delimiter);
    const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'CSV / TSV', extensions: ['csv', 'tsv', 'txt'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    if ((await stat(file)).size > 2 * 1024 * 1024) throw new Error('文件超过 2 MB，请分批导入');
    return service.prepare(await readFile(file, 'utf8'), 'csv', separator);
  });
  handle('connections:import-preview', (token, options) => service.preview(z.string().uuid().parse(token), options));
  handle('connections:import-apply', (token, rows, policy) => service.apply(z.string().uuid().parse(token), rows, policy));
  handle('connections:import-discard', token => service.discard(z.string().uuid().parse(token)));
}
