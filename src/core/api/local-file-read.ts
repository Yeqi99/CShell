import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { apiLocalFileRootSchema } from '../../shared/contracts';
import { LocalFiles } from '../local-files';
import { DirectoryPages, directoryPageInput } from './directory-page';
import { fileChunkInput } from './sftp-read';
import { ApiError } from './errors';

export const localListInput = directoryPageInput.extend({ rootId: z.string().uuid() });
export const localReadInput = fileChunkInput.extend({ rootId: z.string().uuid() });
export type LocalFileRoot = z.infer<typeof apiLocalFileRootSchema>;

/** Read-only adapter for explicit caller grants. No shell permission or desktop root reuse. */
export class ApiLocalFiles {
  private pages = new Map<string, DirectoryPages>();
  clear() {
    this.pages.clear();
  }
  async resolve(root: LocalFileRoot, path: string, check: () => void) {
    check();
    if (!isAbsolute(root.path))
      throw new ApiError(
        'INVALID_ARGUMENT',
        'Invalid selected root.',
        'Choose the directory again in CShell.',
      );
    const info = await lstat(root.path);
    check();
    if (!info.isDirectory() || info.isSymbolicLink() || `${info.dev}:${info.ino}` !== root.identity)
      throw new ApiError(
        'CONFLICT',
        'Selected directory identity changed.',
        'Choose and authorize the directory again.',
      );
    const files = new LocalFiles();
    const grant = await files.grant(root.path);
    check();
    const target = await files.resolve(grant.root, path);
    check();
    return { files, grant, target };
  }
  async list(owner: string, root: LocalFileRoot, input: unknown, check: () => void) {
    const a = localListInput.parse(input);
    const resolved = await this.resolve(root, a.path, check);
    const list = await resolved.files.list(resolved.grant.root, a.path, check, 50000);
    await this.resolve(root, a.path, check);
    const key = JSON.stringify([owner, root.id, root.identity, root.path]);
    let pages = this.pages.get(key);
    if (!pages) {
      if (this.pages.size >= 672) this.pages.clear();
      pages = new DirectoryPages();
      this.pages.set(key, pages);
    }
    const { rootId: _rootId, ...pageInput } = a;
    return pages.page(list, pageInput);
  }
  async read(root: LocalFileRoot, input: unknown, check: () => void) {
    const a = localReadInput.parse(input);
    if (a.offset > 0 && !a.revision)
      throw new ApiError(
        'INVALID_ARGUMENT',
        'Continuation needs a revision.',
        'Read offset zero first.',
      );
    const { target } = await this.resolve(root, a.path, check);
    const handle = await open(target, 'r');
    try {
      check();
      const before = await handle.stat();
      const currentPath = await lstat(target);
      await this.resolve(root, a.path, check);
      if (
        currentPath.isSymbolicLink() ||
        currentPath.dev !== before.dev ||
        currentPath.ino !== before.ino
      )
        throw new ApiError(
          'CONFLICT',
          'File path changed while opening.',
          'List the directory again before reading.',
        );
      if (!before.isFile())
        throw new ApiError(
          'INVALID_ARGUMENT',
          'Only regular files can be read.',
          'Select a file from local_files_list.',
        );
      const revisionOf = (s: typeof before) =>
        createHash('sha256')
          .update(
            JSON.stringify([root.identity, a.path, s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs]),
          )
          .digest('hex');
      const revision = revisionOf(before);
      if (a.revision && a.revision !== revision)
        throw new ApiError('CONFLICT', 'File changed.', 'Read offset zero again.');
      const buffer = Buffer.alloc(a.limitBytes);
      check();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, a.offset);
      const after = await handle.stat();
      await this.resolve(root, a.path, check);
      if (revisionOf(after) !== revision)
        throw new ApiError('CONFLICT', 'File changed during reading.', 'Read offset zero again.');
      return {
        path: a.path,
        offset: a.offset,
        encoding: 'base64' as const,
        body: buffer.subarray(0, bytesRead).toString('base64'),
        size: after.size,
        revision,
        consistency: 'metadata-best-effort' as const,
        nextOffset: bytesRead && a.offset + bytesRead < after.size ? a.offset + bytesRead : null,
      };
    } finally {
      await handle.close();
    }
  }
}
