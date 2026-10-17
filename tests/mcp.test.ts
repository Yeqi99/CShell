import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm, mkdir, rename, writeFile, appendFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpService } from '../src/core/mcp';
import { Store } from '../src/core/store';
import { SshService } from '../src/core/ssh';
import { fixture } from './fixture';

test('authenticated MCP lifecycle, origin isolation, scoped SSH tools, command consent and token revocation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-mcp-'));
  const fixtureServer = await fixture();
  const store = new Store(directory, {
    encrypt: async (value) => Buffer.from(value).toString('base64'),
    decrypt: async (value) => Buffer.from(value, 'base64').toString(),
  });
  await store.load();
  const profile = {
    id: randomUUID(),
    name: 'MCP test',
    host: '127.0.0.1',
    port: fixtureServer.port,
    username: 'tester',
    group: '',
    favorite: false,
    auth: 'password' as const,
  };
  await store.saveProfile(profile);
  await store.setSecret(profile.id, { password: fixtureServer.password });
  const trusted = new SshService(
    () => {},
    async (_profile, fingerprint) => {
      await store.trust(`${profile.host}:${profile.port}`, fingerprint);
      return true;
    },
  );
  const initial = await trusted.connect(profile, { password: fixtureServer.password });
  trusted.disconnect(initial.sessionId);
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  let consent = false;
  let heldReview: (() => Promise<boolean>) | undefined;
  const service = new McpService(store, directory, async () =>
    heldReview ? heldReview() : consent,
  );
  const client = new Client({ name: 'CShell-test', version: '1' });
  try {
    assert.equal(service.status().running, false);
    await service.configure({
      enabled: true,
      port,
      allowedProfiles: [profile.id],
      allowCommands: false,
    });
    assert.equal(service.status().running, true);
    const url = `http://127.0.0.1:${port}/mcp`,
      token = await service.accessToken();
    assert.equal(
      (await fetch(url, { method: 'POST', headers: { Connection: 'close' } })).status,
      401,
    );
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers: {
            Connection: 'close',
            Authorization: `Bearer ${token}`,
            Origin: 'https://evil.example',
          },
        })
      ).status,
      403,
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Connection: 'close', Authorization: `Bearer ${token}` } },
      }),
    );
    assert.ok(!(await client.listTools()).tools.some((tool) => tool.name === 'execute_command'));
    const listed = await client.callTool({ name: 'list_servers' });
    assert.ok(JSON.stringify(listed).includes(profile.id));
    assert.ok(!JSON.stringify(listed).includes(fixtureServer.password));
    const api = async (path: string, body: unknown, bearer = token) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/${path}`, {
        method: 'POST',
        headers: {
          Connection: 'close',
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const bodyText = await response.text();
      return { status: response.status, body: bodyText ? JSON.parse(bodyText) : null };
    };
    const index = await api('capabilities', { level: 'names', limit: 2 });
    assert.equal(index.status, 200);
    assert.equal(index.body.result.items.length, 2);
    assert.ok(index.body.result.nextCursor);
    assert.ok(index.body.result.items.every((i: object) => !('inputSchema' in i)));
    assert.ok(!JSON.stringify(index.body).includes('execute_command'));
    const restListed = await api('call', { name: 'list_servers' });
    assert.deepEqual(restListed.body.result, listed);
    const nativeListed = await api('invoke', { name: 'list_servers' });
    assert.equal(nativeListed.status, 200);
    assert.deepEqual(
      nativeListed.body.result,
      JSON.parse((listed.content as { text: string }[])[0].text),
    );
    assert.equal(nativeListed.body.apiVersion, '1');
    const paged = await api('invoke', { name: 'list_servers_page', arguments: { limit: 1 } });
    assert.equal(paged.status, 200);
    assert.deepEqual(paged.body.result.items, nativeListed.body.result);
    assert.equal(paged.body.result.nextCursor, null);
    assert.equal(paged.body.result.total, 1);
    await store.saveProfile({ ...profile, id: randomUUID(), name: 'Hidden private server' });
    const hiddenSearch = await api('invoke', { name: 'list_servers_page', arguments: { query: 'Hidden private' } });
    assert.equal(hiddenSearch.status, 200);
    assert.equal(hiddenSearch.body.result.total, 0);
    assert.deepEqual(hiddenSearch.body.result.items, []);
    const mcpPage = await client.callTool({ name: 'list_servers_page', arguments: { query: 'MCP test' } });
    assert.equal(JSON.parse((mcpPage.content as { text: string }[])[0].text).items[0].id, profile.id);
    // Directory filtering must not clone all client policies once per saved server.
    const originalSettings = store.mcpSettings.bind(store);
    const originalSnapshot = store.snapshot.bind(store);
    let settingsReads = 0;
    store.mcpSettings = () => { settingsReads++; return originalSettings(); };
    try {
      await api('invoke', { name: 'list_servers_page', arguments: {} });
      const smallReads = settingsReads;
      const snapshot = originalSnapshot();
      store.snapshot = () => ({ ...snapshot, profiles: [
        ...snapshot.profiles,
        ...Array.from({ length: 1000 }, (_, index) => ({ ...profile, id: randomUUID(), name: `Hidden ${index}` })),
      ] });
      settingsReads = 0;
      const large = await api('invoke', { name: 'list_servers_page', arguments: {} });
      assert.equal(large.status, 200);
      assert.equal(large.body.result.total, 1);
      assert.deepEqual(large.body.result.items, paged.body.result.items);
      assert.ok(settingsReads <= smallReads + 2, `policy reads grew from ${smallReads} to ${settingsReads}`);
    } finally {
      store.mcpSettings = originalSettings;
      store.snapshot = originalSnapshot;
    }
    const nativeMissing = await api('invoke', { name: 'not_a_real_capability' });
    assert.equal(nativeMissing.status, 404);
    assert.equal(nativeMissing.body.error.code, 'NOT_FOUND');
    assert.ok(nativeMissing.body.error.nextAction);
    const nativeDenied = await api('invoke', {
      name: 'connect',
      arguments: { profileId: randomUUID() },
    });
    assert.equal(nativeDenied.status, 403);
    assert.equal(nativeDenied.body.error.code, 'FORBIDDEN');
    const invalidJson = await fetch(`http://127.0.0.1:${port}/api/v1/invoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Connection: 'close' },
      body: '{',
    });
    assert.equal(invalidJson.status, 400);
    assert.equal((await invalidJson.json()).error.code, 'INVALID_ARGUMENT');
    const malformed = await api('call', {
      name: 'connect',
      arguments: { profileId: profile.id, arbitraryHost: 'untrusted' },
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error.code, 'INVALID_ARGUMENT');
    assert.equal(
      (await client.callTool({ name: 'connect', arguments: { profileId: randomUUID() } })).isError,
      true,
    );
    const connected = await client.callTool({
      name: 'connect',
      arguments: { profileId: profile.id },
    });
    const sessionId = JSON.parse((connected.content as { text: string }[])[0].text).sessionId;
    for (const name of ['monitor', 'list_files']) {
      const denied = await api('invoke', { name, arguments: { sessionId, ...(name === 'list_files' ? { path: '.' } : {}) } });
      assert.equal(denied.status, 403, 'legacy read must honor the always-review policy');
      assert.equal(denied.body.error.code, 'FORBIDDEN');
    }
    consent = true;
    const monitored = await client.callTool({ name: 'monitor', arguments: { sessionId } });
    const metrics = JSON.parse((monitored.content as { text: string }[])[0].text);
    assert.equal(metrics.memory, 40, 'legacy monitor retains structured metrics');
    assert.ok(metrics.memoryTotal > 0);
    assert.ok(
      JSON.stringify(
        await client.callTool({ name: 'list_files', arguments: { sessionId, path: '.' } }),
      ).includes('hello.txt'),
    );
    const providerInfo = await client.callTool({
      name: 'describe_connection',
      arguments: { sessionId },
    });
    assert.deepEqual(
      JSON.parse((providerInfo.content as { text: string }[])[0].text).tools,
      [],
      'legacy grants must not silently enable new provider tools',
    );
    const deniedCreate = await api('invoke', {
      name: 'invoke_connection',
      arguments: {
        sessionId,
        tool: 'create_file',
        arguments: { path: 'denied.dat', bodyBase64: 'eA==' },
      },
    });
    assert.equal(deniedCreate.status, 403);
    await assert.rejects(readFile(join(fixtureServer.root, 'denied.dat')));
    assert.equal(
      (
        await client.callTool({
          name: 'invoke_connection',
          arguments: { sessionId, tool: 'read_file', arguments: { path: 'hello.txt' } },
        })
      ).isError,
      true,
    );
    assert.equal(
      (await client.callTool({ name: 'monitor', arguments: { sessionId: randomUUID() } })).isError,
      true,
    );
    const burst = await Promise.allSettled(
      Array.from({ length: 9 }, () =>
        client.callTool({ name: 'connect', arguments: { profileId: profile.id } }),
      ),
    );
    const opened = burst.filter((result) => result.status === 'fulfilled' && !result.value.isError);
    assert.ok(opened.length <= 7, 'one existing connection plus burst must stay within 8');
    consent = false;
    let releaseReadReview!: (approved: boolean) => void;
    let enteredReadReview!: () => void;
    let readReviewCount = 0;
    const readGate = new Promise<boolean>((resolve) => { releaseReadReview = resolve; });
    const readEntered = new Promise<void>((resolve) => { enteredReadReview = resolve; });
    heldReview = () => {
      if (++readReviewCount === 2) enteredReadReview();
      return readGate;
    };
    const pendingReads = ['monitor', 'list_files'].map((name) => api('invoke', {
      name, arguments: { sessionId, ...(name === 'list_files' ? { path: '.' } : {}) },
    }));
    const pendingReadResults = Promise.allSettled(pendingReads);
    await readEntered;
    await service.configure({
      enabled: true,
      port,
      allowedProfiles: [profile.id],
      allowCommands: true,
    });
    releaseReadReview(true);
    for (const read of await pendingReadResults) {
      if (read.status === 'fulfilled') {
        assert.notEqual(read.value.status, 200, 'approval cannot revive a read after authorization generation changes');
        assert.ok(read.value.body.error);
      } else {
        // A service reconfiguration also closes old HTTP transports; no result is returned.
        assert.equal(read.reason?.cause?.code, 'UND_ERR_SOCKET');
      }
    }
    heldReview = undefined;
    const next = await client.callTool({ name: 'connect', arguments: { profileId: profile.id } });
    const nextId = JSON.parse((next.content as { text: string }[])[0].text).sessionId;
    assert.equal(
      (
        await client.callTool({
          name: 'execute_command',
          arguments: { sessionId: nextId, command: 'test' },
        })
      ).isError,
      true,
    );
    consent = true;
    assert.ok(
      !(
        await client.callTool({
          name: 'execute_command',
          arguments: { sessionId: nextId, command: 'test' },
        })
      ).isError,
    );
    await service.configure({
      enabled: true,
      port,
      allowedProfiles: [profile.id],
      allowCommands: true,
      capabilities: ['files.read', 'files.create', 'files.rename', 'files.delete', 'directories.create', 'terminal.read', 'terminal.input'],
      review: 'authorized',
      disclosure: { mode: 'progressive', level: 'names', budgetBytes: 4096 },
    });
    assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), [
      'discover_capabilities',
      'invoke_capability',
    ]);
    const stale = await api('capabilities', {
      level: 'names',
      cursor: index.body.result.nextCursor,
    });
    assert.equal(stale.body.error.code, 'CURSOR_EXPIRED');
    const progressive = await client.callTool({
      name: 'invoke_capability',
      arguments: { name: 'connect', arguments: { profileId: profile.id } },
    });
    const progressiveId = JSON.parse((progressive.content as { text: string }[])[0].text).sessionId;
    assert.ok(progressiveId);
    const directoryContract = await api('capabilities', { sessionId: progressiveId, level: 'guide', query: 'create_directory', budgetBytes: 32768 });
    assert.ok(JSON.stringify(directoryContract.body).includes('directories.create'));
    const directoryCreated = await api('invoke', {
      name: 'invoke_connection',
      arguments: { sessionId: progressiveId, tool: 'create_directory', arguments: { path: './api-created-directory' } },
    });
    assert.equal(directoryCreated.status, 200);
    assert.ok(JSON.stringify(directoryCreated.body.result).includes('server-acknowledged'));
    assert.equal((await stat(join(fixtureServer.root, 'api-created-directory'))).isDirectory(), true);
    const duplicateDirectory = await api('invoke', {
      name: 'invoke_connection',
      arguments: { sessionId: progressiveId, tool: 'create_directory', arguments: { path: './api-created-directory' } },
    });
    assert.notEqual(duplicateDirectory.status, 200, 'existing directory must not be reported as newly created');
    for (const name of ['terminal_state', 'terminal_input', 'terminal_read', 'terminal_resize']) {
      const discovered = await api('capabilities', {
        capabilityId: name,
        level: 'guide',
        budgetBytes: 32768,
      });
      const contract = discovered.body.result.items[0];
      assert.equal(contract.id, name);
      assert.ok(contract.examples.length);
      const textContract = contract.outputSchema.properties.content.items.properties.text;
      assert.equal(textContract.contentMediaType, 'application/json');
      const success = textContract.contentSchema.anyOf[0];
      assert.ok(success.required.includes(name === 'terminal_read' ? 'gap' : 'nextSequence'));
      assert.equal(success.additionalProperties, false);
    }
    const terminalParts: Buffer[] = [];
    let terminalCursor = 0;
    const terminalDeadline = Date.now() + 3000;
    while (Date.now() < terminalDeadline) {
      const page = await api('invoke', {
        name: 'terminal_read',
        arguments: { sessionId: progressiveId, after: terminalCursor, limitBytes: 7 },
      });
      assert.equal(page.status, 200);
      assert.equal(page.body.result.gap, false);
      terminalParts.push(Buffer.from(page.body.result.data, 'base64'));
      terminalCursor = page.body.result.nextCursor;
      if (Buffer.concat(terminalParts).toString('utf8').endsWith('$ ')) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(
      Buffer.concat(terminalParts).toString('utf8'),
      'CShell integration server\r\n你好 🌏\r\n$ ',
    );
    const inputState = await api('invoke', {
      name: 'terminal_state',
      arguments: { sessionId: progressiveId },
    });
    assert.equal(inputState.body.result.nextSequence, 0);
    const exactInput = 'api-input-并发\r';
    const submitted = await Promise.all(
      [0, 1].map(() =>
        api('invoke', {
          name: 'terminal_input',
          arguments: { sessionId: progressiveId, expectedSequence: 0, data: exactInput },
        }),
      ),
    );
    assert.deepEqual(submitted.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      submitted.find((r) => r.status === 200)!.body.result.acknowledgement,
      'local-provider-submission-only',
    );
    const untilInput = Date.now() + 3000;
    while (!fixtureServer.shellInputs.join('').includes(exactInput) && Date.now() < untilInput)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(fixtureServer.shellInputs.join('').split(exactInput).length - 1, 1);
    assert.equal(
      (await api('invoke', { name: 'terminal_state', arguments: { sessionId: progressiveId } }))
        .body.result.nextSequence,
      1,
    );
    assert.equal(
      (
        await api('invoke', {
          name: 'terminal_input',
          arguments: { sessionId: progressiveId, expectedSequence: 0, data: exactInput },
        })
      ).status,
      409,
    );
    const details = await api('call', {
      name: 'describe_connection',
      arguments: { sessionId: progressiveId },
    });
    assert.equal(
      (
        await api('invoke', {
          name: 'terminal_resize',
          arguments: { sessionId: progressiveId, expectedSequence: 1, cols: 120, rows: 40 },
        })
      ).body.result.nextSequence,
      2,
    );
    assert.equal(
      (
        await api('invoke', {
          name: 'terminal_resize',
          arguments: { sessionId: progressiveId, expectedSequence: 1, cols: 120, rows: 40 },
        })
      ).status,
      409,
    );
    const providerTools = JSON.parse(details.body.result.content[0].text).tools;
    assert.ok(providerTools.some((t: { name: string }) => t.name === 'read_file'));
    assert.ok(providerTools.some((t: { name: string }) => t.name === 'read_file_chunk'));
    const fileGuide = await api('capabilities', {
      sessionId: progressiveId,
      capabilityId: 'read_file_chunk',
      level: 'guide',
    });
    const guideContract = fileGuide.body.result.items[0];
    assert.equal(guideContract.outputSchema.type, 'string');
    assert.equal(guideContract.outputSchema.contentMediaType, 'application/json');
    assert.equal(guideContract.outputSchema.contentSchema.properties.encoding.const, 'base64');
    assert.ok(guideContract.examples.length > 0);
    const createCall = (body: string) =>
      api('invoke', {
        name: 'invoke_connection',
        arguments: {
          sessionId: progressiveId,
          tool: 'create_file',
          arguments: { path: 'exclusive.dat', bodyBase64: Buffer.from(body).toString('base64') },
        },
      });
    const simultaneous = await Promise.all([createCall('first'), createCall('second')]);
    assert.equal(simultaneous.filter((r) => r.status === 200).length, 1);
    const createdBytes = await readFile(join(fixtureServer.root, 'exclusive.dat'));
    assert.ok(['first', 'second'].includes(createdBytes.toString()));
    assert.notEqual((await createCall('overwrite')).status, 200);
    assert.deepEqual(await readFile(join(fixtureServer.root, 'exclusive.dat')), createdBytes);
    const binary = Buffer.from(Array.from({ length: 140000 }, (_, i) => i % 256));
    await writeFile(join(fixtureServer.root, 'binary.dat'), binary);
    const chunkCall = (args: object) =>
      api('invoke', {
        name: 'invoke_connection',
        arguments: { sessionId: progressiveId, tool: 'read_file_chunk', arguments: args },
      });
    const renameRevision = JSON.parse((await chunkCall({ path: 'exclusive.dat' })).body.result).revision;
    const renamed = await client.callTool({ name: 'invoke_capability', arguments: {
      name: 'invoke_connection', arguments: { sessionId: progressiveId, tool: 'rename_file', arguments: {
        path: 'exclusive.dat', destination: 'renamed.dat', revision: renameRevision, acceptNonAtomic: true,
      } },
    } });
    assert.ok(!renamed.isError, JSON.stringify(renamed));
    assert.deepEqual(await readFile(join(fixtureServer.root, 'renamed.dat')), createdBytes);
    await assert.rejects(stat(join(fixtureServer.root, 'exclusive.dat')), { code: 'ENOENT' });
    const deleteRevision = JSON.parse((await chunkCall({ path: 'renamed.dat' })).body.result).revision;
    const deleted = await api('invoke', { name: 'invoke_connection', arguments: {
      sessionId: progressiveId, tool: 'delete_file', arguments: { path: 'renamed.dat', revision: deleteRevision, acceptNonAtomic: true },
    } });
    assert.equal(deleted.status, 200);
    assert.equal(JSON.parse(deleted.body.result).deleted, true);
    await assert.rejects(stat(join(fixtureServer.root, 'renamed.dat')), { code: 'ENOENT' });
    const firstChunkResponse = await chunkCall({ path: 'binary.dat', limitBytes: 65536 });
    assert.equal(firstChunkResponse.status, 200);
    const firstChunk = JSON.parse(firstChunkResponse.body.result);
    assert.equal(firstChunk.consistency, 'metadata-best-effort');
    const parts = [Buffer.from(firstChunk.body, 'base64')];
    let offset = firstChunk.nextOffset;
    while (offset !== null) {
      const response = await chunkCall({
        path: 'binary.dat',
        offset,
        revision: firstChunk.revision,
        limitBytes: 65536,
      });
      assert.equal(response.status, 200);
      const chunk = JSON.parse(response.body.result);
      parts.push(Buffer.from(chunk.body, 'base64'));
      offset = chunk.nextOffset;
    }
    assert.deepEqual(Buffer.concat(parts), binary);
    const directoryCall = (cursor?: string) =>
      api('invoke', {
        name: 'invoke_connection',
        arguments: {
          sessionId: progressiveId,
          tool: 'list_files_page',
          arguments: { path: '.', limit: 1, cursor },
        },
      });
    const directoryFirst = JSON.parse((await directoryCall()).body.result);
    assert.equal(directoryFirst.entries.length, 1);
    assert.ok(directoryFirst.nextCursor);
    const directoryNext = JSON.parse((await directoryCall(directoryFirst.nextCursor)).body.result);
    assert.notEqual(directoryNext.entries[0].name, directoryFirst.entries[0].name);
    assert.equal(
      (await chunkCall({ path: 'binary.dat', offset: 1 })).body.error.code,
      'INVALID_ARGUMENT',
    );
    await appendFile(join(fixtureServer.root, 'binary.dat'), 'changed');
    assert.equal(
      (await directoryCall(directoryFirst.nextCursor)).body.error.code,
      'CURSOR_EXPIRED',
    );
    assert.equal(
      (
        await chunkCall({
          path: 'binary.dat',
          offset: firstChunk.nextOffset,
          revision: firstChunk.revision,
        })
      ).body.error.code,
      'CONFLICT',
    );
    consent = false;
    const noReview = await api('call', {
      name: 'execute_command',
      arguments: { sessionId: progressiveId, command: 'test' },
    });
    assert.ok(
      !noReview.body.result.isError,
      'explicit authorized review policy avoids per-command confirmation',
    );
    assert.equal(
      (
        await api('call', {
          name: 'execute_command',
          arguments: { sessionId: nextId, command: 'test' },
        })
      ).body.result.isError,
      true,
    );
    const alice = randomUUID(),
      bob = randomUUID();
    consent = true;
    await service.configure({
      enabled: true,
      port,
      allowedProfiles: [],
      allowCommands: false,
      clients: [alice, bob].map((id) => ({
        id,
        name: id,
        enabled: true,
        allowedProfiles: [profile.id],
        allowCommands: id === alice,
        capabilities: ['terminal.read', 'terminal.input'],
        review: id === alice ? 'always' : 'authorized',
        disclosure: { mode: 'progressive', level: 'names', budgetBytes: 4096 },
      })),
    });
    const aliceToken = await service.accessToken(alice),
      bobToken = await service.accessToken(bob);
    assert.notEqual(aliceToken, bobToken);
    const openFor = async (bearer: string) =>
      JSON.parse(
        (await api('call', { name: 'connect', arguments: { profileId: profile.id } }, bearer)).body
          .result.content[0].text,
      ).sessionId;
    const aliceSession = await openFor(aliceToken),
      bobSession = await openFor(bobToken);
    assert.ok(aliceSession && bobSession);
    const foreignInput = await api(
      'invoke',
      {
        name: 'terminal_input',
        arguments: { sessionId: aliceSession, expectedSequence: 0, data: 'forbidden' },
      },
      bobToken,
    );
    assert.equal(foreignInput.status, 404);
    consent = false;
    const rejectedInput = await api(
      'invoke',
      {
        name: 'terminal_input',
        arguments: { sessionId: aliceSession, expectedSequence: 0, data: 'not-approved' },
      },
      aliceToken,
    );
    assert.equal(rejectedInput.status, 403);
    consent = true;
    assert.equal(
      (
        await api(
          'invoke',
          { name: 'terminal_state', arguments: { sessionId: aliceSession } },
          aliceToken,
        )
      ).body.result.nextSequence,
      0,
    );
    const foreignTerminal = await api(
      'invoke',
      { name: 'terminal_read', arguments: { sessionId: aliceSession } },
      bobToken,
    );
    assert.equal(foreignTerminal.status, 404);
    const closedTerminal = await api(
      'invoke',
      { name: 'terminal_read', arguments: { sessionId: progressiveId } },
      aliceToken,
    );
    assert.equal(closedTerminal.status, 404);
    const denied = await api(
      'call',
      { name: 'describe_connection', arguments: { sessionId: aliceSession } },
      bobToken,
    );
    assert.equal(denied.body.result.isError, true, 'client B cannot inspect client A connection');
    const bobIndex = await api('capabilities', {}, bobToken);
    assert.ok(!JSON.stringify(bobIndex.body).includes('execute_command'));
    assert.ok(
      !JSON.stringify(bobIndex.body).includes('list_files'),
      'new clients do not inherit legacy read grants',
    );
    const taskRequest = {
      name: 'task_start',
      arguments: {
        sessionId: aliceSession,
        tool: 'execute_command',
        arguments: { command: 'test' },
        idempotencyKey: 'once',
      },
    };
    const startedTask = JSON.parse(
      (await api('call', taskRequest, aliceToken)).body.result.content[0].text,
    );
    assert.ok(startedTask.taskId);
    const repeatedTask = JSON.parse(
      (await api('call', taskRequest, aliceToken)).body.result.content[0].text,
    );
    assert.equal(repeatedTask.taskId, startedTask.taskId);
    const taskDeadline = Date.now() + 10000;
    let taskResult;
    do {
      taskResult = JSON.parse(
        (
          await api(
            'call',
            { name: 'task_read', arguments: { taskId: startedTask.taskId } },
            aliceToken,
          )
        ).body.result.content[0].text,
      );
      if (!taskResult.settled) await new Promise((r) => setTimeout(r, 20));
    } while (!taskResult.settled && Date.now() < taskDeadline);
    assert.equal(taskResult.state, 'succeeded');
    assert.ok(taskResult.events.some((e: { type: string }) => e.type === 'output'));
    let releaseLoad!: (approved: boolean) => void;
    const loadGate = new Promise<boolean>((resolve) => {
      releaseLoad = resolve;
    });
    heldReview = () => loadGate;
    const blocked = Array.from({ length: 8 }, () =>
      api(
        'call',
        {
          name: 'execute_command',
          arguments: { sessionId: aliceSession, command: 'test' },
        },
        aliceToken,
      ),
    );
    try {
      const until = Date.now() + 5000;
      let saturated = false;
      do {
        saturated = (await api('capabilities', {}, aliceToken)).status === 429;
        if (!saturated) await new Promise((r) => setTimeout(r, 10));
      } while (!saturated && Date.now() < until);
      assert.ok(saturated, 'ordinary requests reach the bounded per-client admission limit');
      const control = await api(
        'call',
        { name: 'task_read', arguments: { taskId: startedTask.taskId } },
        aliceToken,
      );
      assert.equal(
        control.status,
        200,
        'task status must remain reachable under execution saturation',
      );
      assert.equal(JSON.parse(control.body.result.content[0].text).state, 'succeeded');
      assert.equal(
        (
          await api(
            'call',
            { name: 'task_cancel', arguments: { taskId: startedTask.taskId } },
            aliceToken,
          )
        ).status,
        200,
      );
      assert.equal(
        (await api('call', { name: 'list_servers' }, bobToken)).status,
        200,
        'busy client cannot starve another client',
      );
    } finally {
      releaseLoad(false);
      await Promise.allSettled(blocked);
      heldReview = undefined;
    }
    assert.equal(
      (
        await api(
          'call',
          { name: 'task_read', arguments: { taskId: startedTask.taskId } },
          bobToken,
        )
      ).body.result.isError,
      true,
    );
    let releaseReview!: (value: boolean) => void;
    let enteredReview!: () => void;
    const reviewing = new Promise<void>((resolve) => {
      enteredReview = resolve;
    });
    heldReview = () => {
      enteredReview();
      return new Promise<boolean>((resolve) => {
        releaseReview = resolve;
      });
    };
    const lateApproval = api(
      'call',
      {
        name: 'execute_command',
        arguments: {
          sessionId: aliceSession,
          command: 'test',
        },
      },
      aliceToken,
    );
    await reviewing;
    await service.rotateToken(alice);
    releaseReview(true);
    assert.equal(
      (await lateApproval).body.result.isError,
      true,
      'approval after revocation must never execute',
    );
    heldReview = undefined;
    assert.equal((await api('capabilities', {}, aliceToken)).status, 401);
    assert.equal(
      (
        await api(
          'call',
          { name: 'describe_connection', arguments: { sessionId: bobSession } },
          bobToken,
        )
      ).body.result.isError,
      undefined,
      'rotating A does not close B',
    );
    await service.rotateToken();
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers: { Connection: 'close', Authorization: `Bearer ${token}` },
        })
      ).status,
      401,
    );
    await service.stop();
    await rename(join(directory, 'mcp-audit.jsonl'), join(directory, 'audit-before-failure.jsonl'));
    await mkdir(join(directory, 'mcp-audit.jsonl'));
    await service.start();
    const failedAudit = await api('call', { name: 'list_servers' }, await service.accessToken());
    assert.equal(failedAudit.body.result.isError, true);
    assert.equal(JSON.parse(failedAudit.body.result.content[0].text).code, 'UNAVAILABLE');
    const deniedWithoutAudit = await api(
      'call',
      { name: 'connect', arguments: { profileId: profile.id } },
      await service.accessToken(),
    );
    assert.equal(
      deniedWithoutAudit.body.error.code,
      'UNAVAILABLE',
      'failed audit storage closes execution admission',
    );
    await service.configure({ enabled: false, port, allowedProfiles: [], allowCommands: false });
    assert.equal(service.status().running, false);
  } finally {
    await client.close();
    await service.stop();
    trusted.dispose();
    await fixtureServer.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
