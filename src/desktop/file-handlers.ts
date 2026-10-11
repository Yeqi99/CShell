import { BrowserWindow, dialog } from 'electron';
import { lstat, rename } from 'node:fs/promises';
import { join, posix, relative, sep } from 'node:path';
import { z } from 'zod';
import { fileRefSchema } from '../shared/contracts';
import { LocalFiles, exists } from '../core/local-files';
import { remotePath, safeName } from '../core/paths';
import type { SshService } from '../core/ssh';
import type { Transfers } from '../core/transfers';
type Handler = (name: string, fn: (...args: any[]) => any) => void;
export function registerFileHandlers(
  handle: Handler,
  window: BrowserWindow,
  ssh: SshService,
  transfers: Transfers,
  text: (cn: string, en: string) => string,
) {
  const local = new LocalFiles(),
    id = z.string().uuid();
  const confirm = async (message: string, detail: string) =>
    (
      await dialog.showMessageBox(window, {
        type: 'warning',
        message,
        detail,
        buttons: [text('取消', 'Cancel'), text('确认', 'Confirm')],
        defaultId: 0,
        cancelId: 0,
      })
    ).response === 1;
  handle('local:choose', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: text('选择本地工作目录', 'Choose local working directory'),
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : local.grant(result.filePaths[0]);
  });
  handle('local:list', (root, path) =>
    local.list(id.parse(root), remotePath(z.string().parse(path))),
  );
  handle('local:action', async (root, action, path, destination) => {
    id.parse(root);
    z.enum(['mkdir', 'rename', 'delete']).parse(action);
    remotePath(z.string().parse(path));
    if (destination) remotePath(z.string().parse(destination));
    if (
      action === 'delete' &&
      !(await confirm(
        text('永久删除本地文件或空目录？', 'Permanently delete local file or empty directory?'),
        path,
      ))
    )
      return;
    await local.action(root, action, path, destination);
  });
  handle('file:transfer', async (inputSources, inputTarget, inputMove) => {
    const sources = z.array(fileRefSchema).min(1).max(1000).parse(inputSources),
      target = fileRefSchema.parse(inputTarget),
      move = z.boolean().parse(inputMove);
    remotePath(target.path);
    sources.forEach((source) => remotePath(source.path));
    if (
      move &&
      !(await confirm(
        text(
          '移动所选文件？原位置将不再保留。',
          'Move selected files? They will no longer remain at the source.',
        ),
        sources.map((s) => s.path).join('\n'),
      ))
    )
      return;
    if (target.kind === 'local') {
      const destination = await local.resolve(target.root, target.path);
      if (!(await lstat(destination)).isDirectory()) throw new Error('Target is not a directory');
      for (const source of sources) {
        if (source.kind === 'remote') {
          transfers.enqueue(source.sessionId, 'download', source.path, destination);
          continue;
        }
        const from = await local.resolve(source.root, source.path),
          to = join(destination, safeName(posix.basename(source.path)));
        const rel = relative(from, to);
        if (!rel || (!rel.startsWith('..' + sep) && rel !== '..' && !rel.includes(':')))
          throw new Error('Cannot copy a directory into itself');
        if (move) {
          if (await exists(to)) throw new Error('Destination already exists');
          await rename(from, to);
        } else
          transfers.enqueueOperation(
            'local',
            posix.basename(source.path),
            async (state, signal, publish) => {
              let last = 0;
              await local.copy(from, to, signal, (done, total) => {
                state.done += done;
                state.total += total;
                if (Date.now() - last > 100) {
                  last = Date.now();
                  publish();
                }
              });
            },
          );
      }
    } else {
      const sftp = await ssh.sftp(target.sessionId);
      const destination = await new Promise<string>((r, j) =>
        sftp.realpath(target.path, (e, p) => (e ? j(e) : r(p))),
      );
      const stat = await new Promise<import('ssh2').Stats>((r, j) =>
        sftp.stat(destination, (e, s) => (e ? j(e) : r(s))),
      );
      if (!stat.isDirectory()) throw new Error('Target is not a directory');
      for (const source of sources) {
        if (source.kind === 'local') {
          transfers.enqueue(
            target.sessionId,
            'upload',
            await local.resolve(source.root, source.path),
            destination,
          );
          continue;
        }
        const name = posix.basename(source.path);
        if (!name) throw new Error('Cannot copy root directory');
        const to = posix.join(destination, name);
        if (source.sessionId === target.sessionId) {
          const canonical = await new Promise<string>((r, j) =>
            sftp.realpath(source.path, (e, p) => (e ? j(e) : r(p))),
          );
          if (to === canonical || to.startsWith(canonical.replace(/\/$/, '') + '/'))
            throw new Error('Cannot copy a directory into itself');
          if (move) {
            await ssh.action(source.sessionId, 'rename', source.path, to);
            continue;
          }
        }
        transfers.copyRemote(source.sessionId, source.path, target.sessionId, to);
      }
    }
  });
}
