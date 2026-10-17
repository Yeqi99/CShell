import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Store } from '../src/core/store';
import { PluginService } from '../src/core/plugins';
import { RemoteJobs } from '../src/core/remote-jobs';
import { EnvironmentService } from '../src/core/environments';
import { ApplicationService } from '../src/core/applications';
import { PythonFiles } from '../src/core/python-files';
import { SshService } from '../src/core/ssh';
import {
  pluginManifestSchema,
  environmentActionSchema,
  pluginEnabled,
} from '../src/shared/plugins';
import { fixture } from './fixture';
import { builtinPlugins } from '../src/shared/plugins';
import { marketRoot } from '../src/shared/market';
const until = async (predicate: () => boolean) => {
  const timeout = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > timeout) throw new Error('Timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};
test('plugin lifecycle persists, external protocol cannot claim built-in capabilities', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cshell-plugins-'));
  const codec = { encrypt: async (v: string) => v, decrypt: async (v: string) => v };
  try {
    const store = new Store(dir, codec);
    await store.load();
    const service = new PluginService(store);
    assert.equal(pluginEnabled(store.plugins(), 'vim'), true);
    assert.equal(pluginEnabled(store.plugins(), 'docker'), false);
    await service.install('cshell.docker');
    assert.equal(store.snapshot().tools.dockerEnabled, true);
    await service.toggle('cshell.docker', false);
    assert.equal(store.snapshot().tools.dockerEnabled, false);
    await service.remove('cshell.vim');
    const reopened = new Store(dir, codec);
    await reopened.load();
    assert.equal(pluginEnabled(reopened.plugins(), 'vim'), false);
    const manifest = pluginManifestSchema.parse({
      protocol: 1,
      id: 'example.commands',
      version: '1.0.0',
      name: 'Example',
      description: 'Commands',
      publisher: 'Example',
      provider: 'snippets',
      permissions: ['terminal.input'],
      commands: [{ label: 'Disk', text: 'df -h' }],
    });
    assert.throws(() => pluginManifestSchema.parse({ ...manifest, protocol: 2 }));
    assert.throws(() =>
      pluginManifestSchema.parse({ ...manifest, commands: [{ label: 'bad', text: 'ls\nrm' }] }),
    );
    const oldFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response(JSON.stringify(manifest))) as typeof fetch;
      const entry = {
        manifest,
        url: 'https://example.test/plugin.json',
        sha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
      };
      await service.download(entry);
      assert.equal(pluginEnabled(store.plugins(), 'snippets'), true);
      await assert.rejects(service.download({ ...entry, sha256: '0'.repeat(64) }), /checksum/);
      const privileged = {
        ...manifest,
        provider: 'python' as const,
        permissions: ['remote.execute' as const],
      };
      globalThis.fetch = (async () => new Response(JSON.stringify(privileged))) as typeof fetch;
      await assert.rejects(
        service.download({
          manifest: privileged,
          url: entry.url,
          sha256: createHash('sha256').update(JSON.stringify(privileged)).digest('hex'),
        }),
        /only contribute/,
      );
    } finally {
      globalThis.fetch = oldFetch;
    }
    const official = builtinPlugins.find((p) => p.id === 'cshell.python')!;
    const body = JSON.stringify(official);
    const entry = {
      manifest: official,
      url: `${marketRoot}/plugins/${official.id}.json`,
      sha256: createHash('sha256').update(body).digest('hex'),
    };
    try {
      globalThis.fetch = (async () => new Response(body)) as typeof fetch;
      await service.download(entry);
      assert.equal(pluginEnabled(store.plugins(), 'python'), true);
      await assert.rejects(
        service.download({ ...entry, url: 'https://example.test/cshell.python.json' }),
        /only contribute/,
      );
    } finally {
      globalThis.fetch = oldFetch;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('remote environments, semantic analysis, installation jobs and disconnect use isolated SSH channels', async () => {
  const server = await fixture(),
    ssh = new SshService(
      () => {},
      async () => true,
    );
  try {
    const { sessionId } = await ssh.connect(
      {
        id: randomUUID(),
        name: 'Extensions test',
        host: '127.0.0.1',
        port: server.port,
        username: 'tester',
        auth: 'password',
        group: '',
        favorite: false,
      },
      { password: server.password },
    );
    const jobs = new RemoteJobs(ssh),
      env = new EnvironmentService(ssh, jobs),
      apps = new ApplicationService(jobs);
    const snapshot = await env.inspect(sessionId);
    assert.equal(snapshot.environments.length, 2);
    const python = snapshot.environments[1].python;
    assert.equal((await env.packages(sessionId, python))[0].name, 'jedi');
    const result = await env.analyze(sessionId, python, 'import os\nos.pa', 2, 5);
    assert.equal(result.completions[0].label, 'path');
    assert.equal(JSON.parse(server.extensions.inputs.at(-1)!).code, 'import os\nos.pa');
    assert.throws(() =>
      environmentActionSchema.parse({ type: 'install', python, packages: ['numpy; whoami'] }),
    );
    await assert.rejects(
      env.action(sessionId, {
        type: 'remove',
        conda: snapshot.conda!,
        prefix: snapshot.environments[0].prefix,
      }),
      /base environment/,
    );
    const plan = await apps.plan(sessionId, { app: 'jedi', python, name: 'work', version: '3.12' });
    assert.equal(jobs.list(sessionId).length, 0); // Planning must not mutate remote host.
    const job = apps.install(plan.id);
    assert.throws(() => apps.install(plan.id), /expired/);
    await until(() => jobs.list(sessionId).find((j) => j.id === job.id)?.state === 'succeeded');
    assert.equal(server.shellInputs.length, 0);
    await assert.rejects(
      apps.plan(sessionId, { app: 'nginx', name: 'work', version: '3.12' }),
      /administrator/,
    );
    const failure = jobs.start(sessionId, 'failure', '# cshell:failure');
    await until(() => jobs.list(sessionId).find((j) => j.id === failure.id)?.state === 'failed');
    const waiting = jobs.start(sessionId, 'wait', '# cshell:wait');
    jobs.cancel(waiting.id);
    assert.equal(jobs.list(sessionId).find((j) => j.id === waiting.id)?.state, 'cancelled');
    const child = await ssh.openEnvironment(
      sessionId,
      `'${snapshot.conda}' run --no-capture-output --prefix '/home/test/miniconda3/envs/science' bash -i`,
    );
    ssh.disconnect(child.sessionId);
    await until(() => {
      try {
        ssh.get(child.sessionId);
        return false;
      } catch {
        return true;
      }
    });
    assert.ok(ssh.get(sessionId));
    const files = new PythonFiles(ssh);
    await writeFile(join(server.root, 'sample.py'), 'import os\n');
    // ssh2's test server has a fixed empty extension advertisement; the fixture implements the real extension packet above.
    ((await ssh.sftp(sessionId)) as unknown as { _extensions: Record<string, string> })._extensions[
      'posix-rename@openssh.com'
    ] = '1';
    const read = await files.read(sessionId, '/sample.py');
    assert.equal(read.code, 'import os\n');
    await writeFile(join(server.root, 'sample.py'), 'print(1)\n');
    await assert.rejects(
      files.save(sessionId, '/sample.py', 'print(2)', read.revision),
      /changed on the server/,
    );
    const fresh = await files.read(sessionId, '/sample.py');
    const saved = await files.save(sessionId, '/sample.py', 'print(3)\n', fresh.revision);
    assert.equal((await files.read(sessionId, '/sample.py')).code, 'print(3)\n');
    assert.notEqual(saved.revision, fresh.revision);
    const cancelledStart = env.startJupyter(sessionId, python, 8888);
    const cancelledResult = assert.rejects(cancelledStart, /stopped|abort|cancel/i);
    env.stopJupyter(sessionId, python);
    await cancelledResult;
    assert.equal(env.jupyterStatus(sessionId, python).running, false);
    const notebookUrl = await env.startJupyter(sessionId, python, 8888);
    assert.equal(new URL(notebookUrl).hostname, '127.0.0.1');
    assert.equal(new URL(notebookUrl).searchParams.get('token')?.length, 64);
    assert.equal(await (await fetch(notebookUrl)).text(), 'Jupyter');
    assert.equal(env.jupyterStatus(sessionId, python).running, true);
    assert.equal(await env.startJupyter(sessionId, python, 8888), notebookUrl);
    await assert.rejects(env.startJupyter(sessionId, python, 8889), /different port/);
    assert.ok(
      server.extensions.commands.some(
        (c) => c.includes('--ServerApp.ip=127.0.0.1') && c.includes('--ServerApp.port_retries=0'),
      ),
    );
    env.stopAllJupyter();
    assert.equal(env.jupyterStatus(sessionId, python).running, false);
    const disconnected = jobs.start(sessionId, 'disconnect', '# cshell:wait');
    ssh.disconnect(sessionId);
    await until(
      () => jobs.list(sessionId).find((j) => j.id === disconnected.id)?.state === 'failed',
    );
    await assert.rejects(env.inspect(sessionId), /not connected/);
  } finally {
    ssh.dispose();
    await server.close();
  }
});
