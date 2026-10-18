import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/core/store';
import { SshService } from '../src/core/ssh';
import { PluginService } from '../src/core/plugins';
import { createExtensionServices } from '../src/core/api/extensions';
import { createSshManager } from '../src/core/connections/ssh-provider';
import { McpService } from '../src/core/mcp';
import { fixture } from './fixture';

test('shared extension API enforces target overrides, plugin availability and installation plan session ownership', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cshell-api-extensions-'));
  const server = await fixture();
  const store = new Store(dir, {
    encrypt: async (s) => Buffer.from(s).toString('base64'),
    decrypt: async (s) => Buffer.from(s, 'base64').toString(),
  });
  await store.load();
  const profiles = [0, 1].map((i) => ({
    id: randomUUID(),
    name: `Target ${i}`,
    host: '127.0.0.1',
    port: server.port,
    username: 'tester',
    group: '',
    favorite: false,
    auth: 'password' as const,
  }));
  for (const p of profiles) await store.saveProfile(p);
  let service: McpService;
  const ssh = new SshService(
    (e) => {
      service?.event(e);
    },
    async () => true,
  );
  const extensions = createExtensionServices(ssh, store);
  const manager = createSshManager(ssh, () => store.snapshot().profiles, extensions.tools);
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((r) => probe.close(() => r()));
  service = new McpService(store, dir, async () => true, {
    manager,
    applicationTools: extensions.applicationTools,
    connectEnvironment: async (parent, conda, prefix, signal, ready) => {
      let child: string | undefined;
      try {
        const result = await extensions.environments.openTerminal(
          parent,
          conda,
          prefix,
          signal,
          (id) => {
            child = id;
            manager.adopt('cshell.ssh', id);
            ready(id);
          },
        );
        return result.sessionId;
      } catch (error) {
        if (child) await manager.disconnect(child);
        throw error;
      }
    },
    connect: (p, signal, ready) =>
      manager.connect('cshell.ssh', p, { password: server.password }, signal, ready),
  });
  try {
    for (const tool of extensions.applicationTools) {
      assert.ok(tool.jsonOutput, `${tool.name} declares its actual JSON result`);
      for (const example of tool.examples ?? []) tool.input.parse(example.input);
    }
    const pluginsList = extensions.applicationTools.find((tool) => tool.name === 'plugins_list')!;
    pluginsList.jsonOutput!.parse(
      JSON.parse(await pluginsList.invoke({}, new AbortController().signal)),
    );
    await service.configure({
      enabled: true,
      port,
      allowedProfiles: profiles.map((p) => p.id),
      allowCommands: false,
      capabilities: [],
      review: 'authorized',
      applicationCapabilities: ['plugins.read'],
      targetPolicies: {
        [profiles[0].id]: {
          allowCommands: false,
          capabilities: [
            'terminal.input',
            'terminal.read',
            'environments.read',
            'environments.manage',
            'applications.read',
            'applications.install',
          ],
          review: 'authorized',
        },
        [profiles[1].id]: { allowCommands: false, capabilities: [], review: 'authorized' },
        [randomUUID()]: { allowCommands: true, capabilities: ['files.read'], review: 'authorized' },
      },
    });
    const token = await service.accessToken();
    const call = async (name: string, args: object = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/invoke`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Connection: 'close',
        },
        body: JSON.stringify({ name, arguments: args }),
      });
      return response.json();
    };
    const a = (await call('connect', { profileId: profiles[0].id })).result.sessionId;
    const b = (await call('connect', { profileId: profiles[1].id })).result.sessionId;
    assert.ok(a && b);
    assert.ok(Array.isArray((await call('plugins_list')).result));
    assert.equal(
      (await call('plugin_manage', { id: 'cshell.conda', action: 'install' })).error.code,
      'NOT_FOUND',
    );
    const invoke = (sessionId: string, tool: string, args = {}) =>
      call('invoke_connection', { sessionId, tool, arguments: args });
    assert.equal((await invoke(b, 'applications_list')).error.code, 'FORBIDDEN');
    assert.equal(
      (await invoke(a, 'execute_command', { command: 'whoami' })).error.code,
      'FORBIDDEN',
    );
    assert.ok(
      !(await call('describe_connection', { sessionId: a })).result.tools.some(
        (t: any) => t.name === 'environments_list',
      ),
    );
    await new PluginService(store).install('cshell.conda');
    const env = await invoke(a, 'environments_list');
    const snapshot = typeof env.result === 'string' ? JSON.parse(env.result) : env.result;
    assert.equal(snapshot.environments.length, 2);
    const child = await call('connect', {
      profileId: profiles[0].id,
      environment: {
        parentSessionId: a,
        conda: snapshot.conda,
        prefix: snapshot.environments[1].prefix,
      },
    });
    assert.ok(child.result?.sessionId, JSON.stringify(child));
    assert.notEqual(child.result.sessionId, a);
    assert.equal((await call('describe_connection', { sessionId: child.result.sessionId })).result.terminalEnvironment.prefix, snapshot.environments[1].prefix);
    let childOutput = '';
    for (let attempt = 0; attempt < 20 && !childOutput; attempt++) {
      const output = await call('terminal_read', { sessionId: child.result.sessionId });
      assert.ok(!output.error, JSON.stringify(output));
      childOutput = Buffer.from(output.result.data, 'base64').toString();
      if (!childOutput) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.match(childOutput, /science/);
    assert.ok(!(await call('disconnect', { sessionId: child.result.sessionId })).error);
    assert.ok(!(await invoke(a, 'environments_list')).error, 'Closing child preserves parent');
    assert.equal(
      (
        await call('connect', {
          profileId: profiles[1].id,
          environment: {
            parentSessionId: a,
            conda: snapshot.conda,
            prefix: snapshot.environments[1].prefix,
          },
        })
      ).error.code,
      'FORBIDDEN',
    );
    const notebook = await invoke(a, 'environment_jupyter_start', {
      python: snapshot.environments[1].python,
      port: 8888,
    });
    assert.deepEqual(JSON.parse(notebook.result), { running: true, port: 8888 });
    assert.ok(!JSON.stringify(notebook).includes('token='));
    assert.equal(
      (await invoke(b, 'environment_jupyter_status', { python: snapshot.environments[1].python }))
        .error.code,
      'FORBIDDEN',
    );
    assert.deepEqual(
      JSON.parse(
        (await invoke(a, 'environment_jupyter_stop', { python: snapshot.environments[1].python }))
          .result,
      ),
      { running: false },
    );
    assert.ok(
      (
        await invoke(a, 'python_analyze', {
          python: snapshot.environments[1].python,
          code: 'import os\nos.pa',
          line: 2,
          column: 5,
        })
      ).error,
    );
    await extensions.plugins.install('cshell.python');
    for (const name of [
      'python_analyze',
      'python_file_read',
      'python_file_save',
      'environments_list',
      'environment_packages',
      'environment_action',
      'applications_list',
      'application_plan',
      'application_install',
    ]) {
      const tool = manager.tools.tools(a).find((tool) => tool.name === name)!;
      assert.ok(tool.jsonOutput, `${name} must expose a typed result`);
      assert.ok(tool.examples?.length, `${name} must include a usable guide example`);
      for (const example of tool.examples!) tool.input.parse(example.input);
    }
    const analyzed = await invoke(a, 'python_analyze', {
      python: snapshot.environments[1].python,
      code: 'import os\nos.pa',
      line: 2,
      column: 5,
    });
    assert.ok(!analyzed.error, JSON.stringify(analyzed));
    assert.ok(JSON.parse(analyzed.result).completions.length > 0);
    assert.equal(
      (
        await invoke(b, 'python_analyze', {
          python: snapshot.environments[1].python,
          code: '',
          line: 1,
          column: 0,
        })
      ).error.code,
      'FORBIDDEN',
    );
    assert.equal(
      (
        await invoke(a, 'python_file_save', {
          path: '/sample.py',
          code: '',
          revision: 'a'.repeat(64),
          acceptNonAtomic: true,
        })
      ).error.code,
      'FORBIDDEN',
    );
    await extensions.plugins.toggle('cshell.python', false);
    assert.ok(
      (
        await invoke(a, 'python_analyze', {
          python: snapshot.environments[1].python,
          code: '',
          line: 1,
          column: 0,
        })
      ).error,
    );
    const planResponse = await invoke(a, 'application_plan', {
      app: 'jedi',
      python: snapshot.environments[1].python,
    });
    const plan =
      typeof planResponse.result === 'string'
        ? JSON.parse(planResponse.result)
        : planResponse.result;
    assert.ok(plan.id);
    assert.throws(() => extensions.apps.install(plan.id, b), /another session/);
    assert.equal(extensions.jobs.list(a).length, 0);
    const installed = await invoke(a, 'application_install', { planId: plan.id });
    assert.ok(!installed.error, JSON.stringify(installed));
    assert.equal(extensions.jobs.list(a)[0].state, 'succeeded');
    assert.equal(server.shellInputs.length, 0);
    await new PluginService(store).toggle('cshell.conda', false);
    assert.ok((await invoke(a, 'environments_list')).error);
    await service.configure({
      ...service.status().settings,
      allowedProfiles: [],
      targetPolicies: {},
      applicationCapabilities: ['plugins.manage'],
    });
    assert.equal(
      (await call('plugin_manage', { id: 'cshell.conda', action: 'enable' })).result.applied,
      true,
    );
    assert.deepEqual(
      service.status().settings.allowedProfiles,
      [],
      'plugin management cannot grant machine access',
    );
  } finally {
    await service.stop();
    ssh.dispose();
    await server.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
