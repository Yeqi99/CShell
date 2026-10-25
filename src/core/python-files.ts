import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';
import type { SshService } from './ssh';
import { remotePath } from './paths';
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
export class PythonFiles {
  private static writes = new Set<string>();
  constructor(private ssh: SshService, private textFiles = false) {}
  private path(input: string) {
    const path = posix.normalize(remotePath(input));
    if (!this.textFiles && !path.endsWith('.py')) throw new Error('Only Python files are supported by this editor');
    return path;
  }
  async read(sessionId: string, input: string) {
    const path = this.path(input),
      sftp = await this.ssh.sftp(sessionId);
    const bytes = await new Promise<Buffer>((resolve, reject) => {
      const stream = sftp.createReadStream(path);
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1_000_000) stream.destroy(new Error('File exceeds 1 MB'));
        else chunks.push(chunk);
      });
      stream.once('error', reject);
      stream.once('end', () => resolve(Buffer.concat(chunks)));
    });
    const code = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (/[\x00-\x08\x0b\x0e-\x1f]/.test(code)) throw new Error('Binary files cannot be opened in the text editor');
    return { code, revision: hash(bytes) };
  }
  async save(
    sessionId: string,
    input: string,
    code: string,
    revision: string,
    beforeWrite?: () => void,
  ) {
    const path = this.path(input),
      key = `${sessionId}:${path}`;
    const sftp = await this.ssh.sftp(sessionId);
    // ssh2 1.17 validates this same advertised VERSION extension before sending
    // an atomic replacement. Reject before creating any temporary remote file.
    if ((sftp as unknown as { _extensions?: Record<string,string> })._extensions?.['posix-rename@openssh.com'] !== '1')
      throw new Error('服务器不支持安全的原子替换，原文件未修改。请下载后编辑并另存为新文件，或由管理员启用 OpenSSH 原子重命名支持。');
    if (PythonFiles.writes.has(key)) throw new Error('A save is already in progress');
    z.string().max(1_000_000).parse(code);
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(revision);
    if (Buffer.byteLength(code) > 1_000_000) throw new Error('File exceeds 1 MB');
    if (code.includes('\0')) throw new Error('Binary content cannot be saved in the text editor');
    PythonFiles.writes.add(key);
    const temporary = posix.join(posix.dirname(path), `.cshell-${randomUUID()}.tmp`);
    try {
      beforeWrite?.();
      const current = await this.read(sessionId, path);
      if (current.revision !== revision)
        throw new Error('File changed on the server. Reopen it before saving.');
      const attrs = await new Promise<import('ssh2').Stats>((resolve, reject) =>
        sftp.lstat(path, (e, a) => (e ? reject(e) : resolve(a))),
      );
      if (!attrs.isFile()) throw new Error('Only regular files can be saved');
      beforeWrite?.();
      await new Promise<void>((resolve, reject) => {
        const stream = sftp.createWriteStream(temporary, { flags: 'wx', mode: attrs.mode & 0o777 });
        stream.once('error', reject);
        stream.once('close', resolve);
        stream.end(code);
      });
      await new Promise<void>((resolve, reject) =>
        sftp.setstat(
          temporary,
          { uid: attrs.uid, gid: attrs.gid, mode: attrs.mode & 0o7777 },
          (error) => (error ? reject(error) : resolve()),
        ),
      );
      if ((await this.read(sessionId, path)).revision !== revision)
        throw new Error('File changed on the server while saving');
      beforeWrite?.();
      await new Promise<void>((resolve, reject) =>
        sftp.ext_openssh_rename(temporary, path, (e) => (e ? reject(e) : resolve())),
      );
      return { revision: hash(Buffer.from(code)) };
    } finally {
      PythonFiles.writes.delete(key);
      sftp.unlink(temporary, () => {});
    }
  }
}
