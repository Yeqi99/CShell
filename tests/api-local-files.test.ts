import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/core/store';
import { McpService } from '../src/core/mcp';
import { ApiLocalFiles } from '../src/core/api/local-file-read';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('local file API isolates caller roots, bounds chunks and revokes persisted grants', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cshell-local-api-'));
  const roots = await Promise.all(
    ['first', 'private'].map(async (name) => {
      const path = join(dir, name);
      await mkdir(path);
      const info = await stat(path);
      return { id: randomUUID(), name, path, identity: `${info.dev}:${info.ino}` };
    }),
  );
  const body = Buffer.alloc(70000, 0x61);
  await writeFile(join(roots[0].path, 'data.bin'), body);
  await writeFile(join(roots[0].path, 'second.txt'), 'second');
  await writeFile(join(roots[1].path, 'secret.txt'), 'hidden');
  const store = new Store(dir, {
    encrypt: async (s) => Buffer.from(s).toString('base64'),
    decrypt: async (s) => Buffer.from(s, 'base64').toString(),
  });
  await store.load();
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  let holdApproval = false;
  let enteredApproval: () => void = () => {};
  const service = new McpService(store, dir, async (_target, _description, signal) => {
    if (!holdApproval) return true;
    enteredApproval();
    await new Promise<void>((resolve) => {
      if (signal?.aborted) resolve();
      else signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    return true;
  });
  const clientId = randomUUID();
  try {
    await service.configure({
      enabled: true,
      port,
      allowedProfiles: [],
      allowCommands: false,
      review: 'authorized',
      localFileRoots: [roots[0]],
      clients: [
        {
          id: clientId,
          name: 'Other',
          enabled: true,
          allowedProfiles: [],
          allowCommands: false,
          capabilities: [],
          localFileRoots: [roots[1]],
          review: 'authorized',
          disclosure: { mode: 'full', level: 'contract', budgetBytes: 65536 },
        },
      ],
    });
    const token = await service.accessToken();
    const otherToken = await service.accessToken(clientId);
    const mcp = new Client({ name: 'local-files-test', version: '1' });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${otherToken}` } },
      }),
    );
    try {
      const tools = await mcp.listTools();
      assert.ok(
        tools.tools.find((tool) => tool.name === 'local_file_read')?.inputSchema.properties?.rootId,
      );
      const reply = await mcp.callTool({
        name: 'local_file_read',
        arguments: { rootId: roots[1].id, path: '/secret.txt' },
      });
      assert.notEqual(reply.isError, true);
      const content = reply.content as { type: string; text: string }[];
      assert.equal(Buffer.from(JSON.parse(content[0].text).body, 'base64').toString(), 'hidden');
    } finally {
      await mcp.close();
    }
    const call = async (name: string, args: object = {}, bearer = token) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/invoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Connection: 'close' },
        body: JSON.stringify({ name, arguments: args }),
      });
      return { status: response.status, body: await response.json() };
    };
    assert.deepEqual((await call('local_file_roots')).body.result.roots, [
      { id: roots[0].id, name: 'first', mutations: [] },
    ]);
    assert.deepEqual((await call('local_file_roots', {}, otherToken)).body.result.roots, [
      { id: roots[1].id, name: 'private', mutations: [] },
    ]);
    assert.notEqual((await call('local_file_task_start', {})).status, 200);
    assert.equal(
      (await call('local_file_read', { rootId: roots[1].id, path: '/secret.txt' })).status,
      403,
    );
    const page = await call('local_files_list', { rootId: roots[0].id, path: '/', limit: 1 });
    assert.equal(page.status, 200);
    assert.ok(page.body.result.nextCursor);
    const foreignCursor = await call(
      'local_files_list',
      { rootId: roots[1].id, path: '/', limit: 1, cursor: page.body.result.nextCursor },
      otherToken,
    );
    assert.equal(foreignCursor.status, 409);
    const first = await call('local_file_read', {
      rootId: roots[0].id,
      path: '/data.bin',
      limitBytes: 65536,
    });
    assert.equal(first.status, 200);
    assert.equal(Buffer.from(first.body.result.body, 'base64').length, 65536);
    const next = await call('local_file_read', {
      rootId: roots[0].id,
      path: '/data.bin',
      offset: first.body.result.nextOffset,
      revision: first.body.result.revision,
    });
    assert.deepEqual(
      Buffer.concat([
        Buffer.from(first.body.result.body, 'base64'),
        Buffer.from(next.body.result.body, 'base64'),
      ]),
      body,
    );
    assert.equal(next.body.result.nextOffset, null);
    await writeFile(join(roots[0].path, 'data.bin'), 'changed');
    assert.equal(
      (
        await call('local_file_read', {
          rootId: roots[0].id,
          path: '/data.bin',
          revision: first.body.result.revision,
        })
      ).status,
      409,
    );
    await symlink(roots[1].path, join(roots[0].path, 'escape'), 'junction');
    assert.notEqual(
      (await call('local_file_read', { rootId: roots[0].id, path: '/escape/secret.txt' })).status,
      200,
    );
    await service.configure({
      ...service.status().settings,
      localFileRoots: [
        { ...roots[0], mutations: ['create', 'write', 'rename', 'delete', 'mkdir', 'rmdir'] },
      ],
    });
    const start = async (operation: object, key = randomUUID()) =>
      call('local_file_task_start', {
        rootId: roots[0].id,
        operation: { acceptNonAtomic: true, ...operation },
        idempotencyKey: key,
      });
    assert.equal((await start({ action: 'renameDirectory', path: '/old', destination: '/new', revision: 'a'.repeat(64) })).status, 403);
    const finish = async (reply: Awaited<ReturnType<typeof start>>) => {
      assert.equal(reply.status, 200, JSON.stringify(reply.body));
      for (let attempt = 0; attempt < 100; attempt++) {
        const task = await call('task_read', { taskId: reply.body.result.taskId });
        assert.equal(task.status, 200, JSON.stringify(task.body));
        if (['succeeded', 'failed', 'cancelled', 'unknown'].includes(task.body.result.state))
          return task.body.result;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('Local mutation did not settle');
    };
    const create = {
      action: 'create',
      path: '/new.bin',
      bodyBase64: Buffer.from('hello').toString('base64'),
    };
    const key = randomUUID();
    const created = await start(create, key);
    assert.equal((await finish(created)).state, 'succeeded');
    const writer = new Client({ name: 'local-mutation-client', version: '1' });
    await writer.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }));
    try {
      const reply = await writer.callTool({ name: 'local_file_task_start', arguments: {
        rootId: roots[0].id, idempotencyKey: key, operation: { ...create, acceptNonAtomic: true },
      } });
      assert.notEqual(reply.isError, true);
      assert.equal(JSON.parse((reply.content as { text: string }[])[0].text).taskId, created.body.result.taskId);
    } finally { await writer.close(); }
    assert.equal((await start(create, key)).body.result.taskId, created.body.result.taskId);
    assert.equal((await start({ ...create, path: '/different.bin' }, key)).status, 409);
    assert.notEqual(
      (
        await call(
          'local_file_task_start',
          {
            rootId: roots[0].id,
            operation: { ...create, acceptNonAtomic: true },
            idempotencyKey: randomUUID(),
          },
          otherToken,
        )
      ).status,
      200,
    );
    const metadata = async (path: string) =>
      (await call('local_file_stat', { rootId: roots[0].id, path })).body.result.revision;
    const rev = await metadata('/new.bin');
    assert.equal(
      (
        await finish(
          await start({
            action: 'write',
            path: '/new.bin',
            revision: rev,
            offset: 0,
            bodyBase64: 'WA==',
          }),
        )
      ).state,
      'succeeded',
    );
    assert.equal(
      (await finish(await start({ action: 'delete', path: '/new.bin', revision: rev }))).state,
      'failed',
    );
    assert.equal(
      (
        await finish(
          await start({
            action: 'rename',
            path: '/new.bin',
            destination: '/renamed.bin',
            revision: await metadata('/new.bin'),
          }),
        )
      ).state,
      'succeeded',
    );
    assert.equal(
      (
        await finish(
          await start({
            action: 'delete',
            path: '/renamed.bin',
            revision: await metadata('/renamed.bin'),
          }),
        )
      ).state,
      'succeeded',
    );
    await service.configure({ ...service.status().settings, localFileRoots: [{ ...roots[0], mutations: ['mkdir', 'rmdir', 'create', 'renameDirectory'] }] });
    assert.equal((await finish(await start({ action: 'mkdir', path: '/source-directory' }))).state, 'succeeded');
    assert.equal((await finish(await start({ action: 'renameDirectory', path: '/source-directory', destination: '/empty', revision: await metadata('/source-directory') }))).state, 'succeeded');
    assert.equal(
      (
        await finish(
          await start({ action: 'rmdir', path: '/empty', revision: await metadata('/empty') }),
        )
      ).state,
      'succeeded',
    );
    await service.configure({ ...service.status().settings, review: 'always' });
    holdApproval = true;
    const approval = new Promise<void>((resolve) => {
      enteredApproval = resolve;
    });
    await start({ ...create, path: '/revoked.bin' });
    await approval;
    await service.configure({ ...service.status().settings, localFileRoots: [] });
    await assert.rejects(stat(join(roots[0].path, 'revoked.bin')), { code: 'ENOENT' });
    assert.notEqual(
      (await call('local_file_read', { rootId: roots[0].id, path: '/data.bin' })).status,
      200,
    );
    assert.deepEqual(store.mcpSettings().localFileRoots, []);
    const reader = new ApiLocalFiles();
    let checks = 0;
    await assert.rejects(
      reader.read(roots[0], { rootId: roots[0].id, path: '/data.bin' }, () => {
        if (++checks > 6) throw new Error('revoked');
      }),
      /revoked/,
    );
  } finally {
    await service.stop();
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
