import { extensionsFixture } from './extensions-fixture';
import { dockerFixture } from './docker-fixture';
import ssh2, { type Connection } from 'ssh2';
const { Server, utils } = ssh2;
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, posix } from 'node:path';
export async function fixture(
  options: {
    stallAuthentication?: boolean;
    stallShell?: boolean;
    writeFailure?: 'full' | 'permission';
  } = {},
) {
  const docker = dockerFixture();
  const extensions = extensionsFixture();
  const shellInputs: string[] = [];
  const shells = new Set<import('ssh2').ServerChannel>();
  let authenticationRequests = 0,
    shellRequests = 0;
  const root = await fs.mkdtemp(join(tmpdir(), 'cshell-ssh-'));
  const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs1',
    format: 'pem',
  });
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs1', format: 'pem' })
    .toString();
  const parsed = utils.parseKey(privateKey);
  if (parsed instanceof Error) throw parsed;
  const password = randomUUID(),
    clients = new Set<Connection>();
  await fs.writeFile(join(root, 'hello.txt'), '你好，CShell 🌏\n');
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    docker.attach(client);
    extensions.attach(client);
    let samples = 0;
    clients.add(client);
    client.on('error', () => {});
    client.on('close', () => clients.delete(client));
    client.on('authentication', (ctx) => {
      authenticationRequests++;
      if (options.stallAuthentication) return;
      if (ctx.username !== 'tester') return ctx.reject();
      if (ctx.method === 'password' && ctx.password === password) return ctx.accept();
      if (
        ctx.method === 'publickey' &&
        ctx.key.data.equals(parsed.getPublicSSH()) &&
        (!ctx.signature || parsed.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) === true)
      )
        return ctx.accept();
      ctx.reject();
    });
    client.on('ready', () =>
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (acceptPty) => acceptPty?.());
        session.on('window-change', (acceptChange) => acceptChange?.());
        session.on('shell', (acceptShell) => {
          shellRequests++;
          if (options.stallShell) return;
          const shell = acceptShell();
          shells.add(shell);
          shell.on('close', () => shells.delete(shell));
          shell.on('error', () => {});
          const banner = Buffer.from('CShell integration server\r\n你好 🌏\r\n$ ');
          shell.write(banner.subarray(0, 29));
          setTimeout(() => {
            if (!shell.destroyed) shell.write(banner.subarray(29));
          }, 20);
          shell.on('data', (data: Buffer) => {
            shellInputs.push(data.toString());
            shell.write(data);
          });
        });
        session.on('exec', (acceptExec, _reject, info) => {
          const stream = acceptExec();
          if (extensions.handle(info.command, stream)) return;
          if (info.command.includes('--query-gpu=')) {
            stream.exit(0);
            stream.end('__NVIDIA__\nNVIDIA Test GPU, 12, 400, 24564\n__PCI__\n');
            return;
          }
          if (info.command.includes('ps -eo pid=')) {
            stream.exit(0);
            stream.end('  101 tester 12.5 1.2 python3\n  202 root 0.2 0.1 sshd\n');
            return;
          }
          samples++;
          stream.exit(0);
          stream.end(
            `__CPU__\ncpu ${100 + samples * 10} 0 20 ${800 + samples * 90} 10 0 0 0\ncpu0 25 0 5 200\ncpu1 25 0 5 200\ncpu2 25 0 5 200\ncpu3 25 0 5 200\n__MEM__\nMemTotal: 16384000 kB\nMemAvailable: 9830400 kB\n__DISK__\n/dev/sda 104857600 31457280 73400320 30% /\n__MODEL__\nTest CPU Model\n`,
          );
        });
        session.on('sftp', (acceptSftp) => {
          const sftp = acceptSftp();
          const handles = new Map<
            string,
            { file?: fs.FileHandle; entries?: string[]; path: string }
          >();
          const local = (path: string) => {
            const target = resolve(root, '.' + posix.resolve('/', path).replaceAll('/', sep));
            if (target !== root && !target.startsWith(root + sep)) throw new Error('Path escape');
            return target;
          };
          const attrs = (s: import('node:fs').Stats) => ({
            mode: s.isSymbolicLink() ? 0o120777 : s.isDirectory() ? 0o40755 : 0o100644,
            uid: 1000,
            gid: 1000,
            size: s.size,
            atime: Math.floor(s.atimeMs / 1000),
            mtime: Math.floor(s.mtimeMs / 1000),
          });
          const fail = (id: number, error: any) =>
            sftp.status(id, error.code === 'ENOENT' ? 2 : 4, error.message);
          const handler = (event: string, fn: (...args: any[]) => Promise<unknown>) =>
            (sftp as any).on(
              event,
              (id: number, ...args: any[]) => void fn(id, ...args).catch((e) => fail(id, e)),
            );
          handler('REALPATH', async (id, path) => {
            sftp.name(id, [
              {
                filename: posix.resolve('/', path),
                longname: '',
                attrs: { mode: 0o40755, uid: 1000, gid: 1000, size: 0, atime: 0, mtime: 0 },
              },
            ]);
          });
          for (const op of ['STAT', 'LSTAT'])
            handler(op, async (id, path) => {
              sftp.attrs(id, attrs(await (op === 'LSTAT' ? fs.lstat(local(path)) : fs.stat(local(path)))));
            });
          handler('OPENDIR', async (id, path) => {
            const key = randomUUID();
            handles.set(key, { path: local(path), entries: await fs.readdir(local(path)) });
            sftp.handle(id, Buffer.from(key));
          });
          handler('READDIR', async (id, handle) => {
            const h = handles.get(handle.toString())!;
            if (!h.entries?.length) return sftp.status(id, 1);
            const entries = h.entries;
            h.entries = [];
            sftp.name(
              id,
              await Promise.all(
                entries.map(async (name) => ({
                  filename: name,
                  longname: name,
                  attrs: attrs(await fs.stat(join(h.path, name))),
                })),
              ),
            );
          });
          handler('OPEN', async (id, path, flags) => {
            if (options.writeFailure === 'permission' && flags & 2) {
              sftp.status(id, 3, 'Permission denied');
              return;
            }
            const key = randomUUID();
            const file = await fs.open(local(path), utils.sftp.flagsToString(flags)!);
            handles.set(key, { file, path: local(path) });
            sftp.handle(id, Buffer.from(key));
          });
          handler('READ', async (id, handle, offset, length) => {
            const data = Buffer.alloc(Math.min(length, 65536));
            const { bytesRead } = await handles
              .get(handle.toString())!
              .file!.read(data, 0, data.length, offset);
            if (!bytesRead) sftp.status(id, 1);
            else sftp.data(id, data.subarray(0, bytesRead));
          });
          handler('WRITE', async (id, handle, offset, data) => {
            if (options.writeFailure === 'full') {
              sftp.status(id, 4, 'No space left on device');
              return;
            }
            await handles.get(handle.toString())!.file!.write(data, 0, data.length, offset);
            sftp.status(id, 0);
          });
          handler('FSTAT', async (id, handle) => {
            sftp.attrs(id, attrs(await handles.get(handle.toString())!.file!.stat()));
          });
          handler('SETSTAT', async (id) => {
            sftp.status(id, 0);
          });
          handler('CLOSE', async (id, handle) => {
            await handles.get(handle.toString())?.file?.close();
            handles.delete(handle.toString());
            sftp.status(id, 0);
          });
          handler('MKDIR', async (id, path) => {
            await fs.mkdir(local(path));
            sftp.status(id, 0);
          });
          handler('RMDIR', async (id, path) => {
            await fs.rmdir(local(path));
            sftp.status(id, 0);
          });
          handler('REMOVE', async (id, path) => {
            await fs.unlink(local(path));
            sftp.status(id, 0);
          });
          handler('EXTENDED', async (id, extension, data: Buffer) => {
            if (extension !== 'posix-rename@openssh.com') {
              sftp.status(id, 8);
              return;
            }
            const length = data.readUInt32BE(0),
              from = data.subarray(4, 4 + length).toString(),
              toLength = data.readUInt32BE(4 + length),
              to = data.subarray(8 + length, 8 + length + toLength).toString();
            await fs.rename(local(from), local(to));
            sftp.status(id, 0);
          });
          handler('RENAME', async (id, from, to) => {
            await fs.rename(local(from), local(to));
            sftp.status(id, 0);
          });
          sftp.on('close', () => {
            sftp.end();
            for (const h of handles.values()) void h.file?.close().catch(() => {});
          });
        });
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    docker,
    extensions,
    shellInputs,
    root,
    password,
    privateKey,
    port: (server.address() as { port: number }).port,
    connectionsCount: () => clients.size,
    authenticationRequests: () => authenticationRequests,
    shellRequests: () => shellRequests,
    writeOutput: (data: string) => {
      for (const shell of shells) shell.write(data);
    },
    disconnectAll: () => {
      for (const client of clients)
        (client as unknown as { _sock: import('node:net').Socket })._sock.destroy();
    },
    close: async () => {
      for (const client of clients) client.end();
      await new Promise<void>((r) => server.close(() => r()));
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
