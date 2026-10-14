import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { AiService } from '../src/core/ai';
import { Store } from '../src/core/store';
import { ConnectionRegistry } from '../src/core/connections/registry';
import { emptyAiPolicy } from '../src/shared/ai';
const until = async (fn: () => boolean) => {
  const end = Date.now() + 10000;
  while (!fn()) {
    if (Date.now() > end) throw new Error('Timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};
const call = (name: string, args: unknown) => ({
  content: null,
  tool_calls: [
    { id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } },
  ],
});
async function setup(reply: (request: any) => any | Promise<any>, runTimeoutMs?: number) {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-ai-work-'));
  const store = new Store(directory, {
    encrypt: async (s) => Buffer.from(s).toString('base64'),
    decrypt: async (s) => Buffer.from(s, 'base64').toString(),
  });
  const profileId = randomUUID(),
    sessionId = randomUUID();
  let live = true,
    executions = 0;
  const registry = new ConnectionRegistry(() => ({ id: profileId, group: '' }));
  const connection = {
    target: {
      providerId: 'test.work',
      resourceId: profileId,
      identity: 'fixed',
      label: 'Test machine',
    },
    tools: [
      {
        name: 'execute_command',
        capability: 'commands.execute',
        description: 'test',
        input: z.object({ command: z.string() }),
        needsReview: () => true,
        invoke: async () => {
          executions++;
          return 'observed: container exited 2026-01-01';
        },
      },
    ],
  };
  registry.register({
    id: 'test.work',
    version: '1.0.0',
    capabilities: ['commands.execute'],
    resolve: () => {
      if (!live) throw new Error('Disconnected');
      return connection;
    },
  });
  registry.bind(sessionId, 'test.work');
  const requests: any[] = [];
  const api = createServer(async (req, res) => {
    try {
      let raw = '';
      for await (const c of req) raw += c;
      const request = JSON.parse(raw);
      requests.push(request);
      const message = await reply(request);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message }] }));
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  const ai = new AiService(directory, store, registry, undefined, { runTimeoutMs });
  const provider = {
    id: randomUUID(),
    name: 'Test',
    url: `http://127.0.0.1:${(api.address() as any).port}/v1`,
    model: 'test',
  };
  await ai.saveProvider(provider);
  const policy = {
    ...emptyAiPolicy(),
    application: ['agents.manage', 'goals.manage'] as ('agents.manage' | 'goals.manage')[],
    profiles: [profileId],
    capabilities: ['commands.execute'] as const,
  };
  await ai.savePolicy(policy);
  const thread = await ai.create('terminal', provider.id, 'allow', sessionId);
  return {
    ai,
    thread,
    requests,
    registry,
    directory,
    store,
    sessionId,
    policy,
    executions: () => executions,
    disconnect: () => {
      live = false;
    },
    idle: () =>
      until(
        () =>
          !['running', 'approval'].includes(
            ai.snapshot().threads.find((t) => t.id === thread.id)!.state,
          ),
      ),
    cleanup: async () => {
      ai.dispose();
      await ai.flush();
      api.closeAllConnections();
      await new Promise<void>((r) => api.close(() => r()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('stopped approval waits for its final history write before cleanup', async () => {
  const f = await setup(() => call('execute_command', { command: 'await review' }));
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  let writing!: () => void;
  const writeStarted = new Promise<void>((resolve) => (writing = resolve));
  const encrypt = f.store.encryptPrivate.bind(f.store);
  try {
    await f.ai.mode(f.thread.id, 'review');
    await f.ai.send(f.thread.id, 'inspect');
    await until(() => !!f.ai.snapshot().threads[0].pending);
    f.store.encryptPrivate = async (data) => {
      const thread = JSON.parse(data).threads.find((t: any) => t.id === f.thread.id);
      if (!['running', 'approval'].includes(thread.state)) {
        writing();
        await blocked;
      }
      return encrypt(data);
    };
    f.ai.dispose();
    let flushed = false;
    const draining = f.ai.flush().then(() => {
      flushed = true;
    });
    await writeStarted;
    // Yield the event loop while disk encryption is deliberately held: thread
    // state is already terminal, but the completion barrier must remain pending.
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(f.ai.snapshot().threads.every((t) => !['running', 'approval'].includes(t.state)));
    assert.equal(flushed, false);
    release();
    await draining;
    const saved = JSON.parse(
      await f.store.decryptPrivate(await readFile(join(f.directory, 'ai.enc'), 'utf8')),
    );
    assert.equal(saved.threads[0].state, 'error');
    assert.equal(saved.threads[0].pending, undefined);
    assert.equal(f.executions(), 0);
  } finally {
    release();
    await f.cleanup();
  }
});

test('parent delegates, collects a child result and child cannot switch machines or review mode', async () => {
  const f = await setup((req) => {
    const task = req.messages.find((m: any) => m.role === 'user')?.content;
    const last = req.messages.at(-1);
    if (task === 'inspect child') {
      assert.ok(!req.tools.some((t: any) => t.function.name === 'connect_machine'));
      assert.ok(!req.tools.some((t: any) => t.function.name === 'set_goal'));
      return last.role === 'tool'
        ? { content: 'child evidence' }
        : call('execute_command', { command: 'inspect' });
    }
    if (last.role !== 'tool') return call('spawn_agent', { task: 'inspect child' });
    const result = JSON.parse(last.content);
    return result.result === 'child evidence'
      ? { content: 'assembled child evidence' }
      : call('wait_agent', { id: result.id });
  });
  try {
    await f.ai.send(f.thread.id, 'coordinate');
    await f.idle();
    const threads = f.ai.snapshot().threads,
      child = threads.find((t) => t.parentId === f.thread.id)!;
    assert.ok(child);
    assert.equal(child.sessionId, f.sessionId);
    assert.equal(f.executions(), 1);
    assert.match(threads.find((t) => t.id === f.thread.id)!.messages.at(-1)!.content, /assembled/);
    await assert.rejects(f.ai.mode(child.id, 'allow'), /继承/);
    await assert.rejects(f.ai.send(child.id, 'orphan work'), /父任务/);
  } finally {
    await f.cleanup();
  }
});

test('revocation during child approval denies execution; stopping parent stops descendants', async () => {
  const f = await setup((req) => {
    const task = req.messages.find((m: any) => m.role === 'user')?.content;
    const last = req.messages.at(-1);
    if (task === 'inspect child')
      return last.role === 'tool'
        ? { content: last.content }
        : call('execute_command', { command: 'delete candidate' });
    if (last.role !== 'tool') return call('spawn_agent', { task: 'inspect child' });
    return call('wait_agent', { id: JSON.parse(last.content).id });
  });
  try {
    await f.ai.mode(f.thread.id, 'restricted');
    await f.ai.send(f.thread.id, 'coordinate');
    await until(() => f.ai.snapshot().threads.some((t) => t.parentId && t.pending));
    const child = f.ai.snapshot().threads.find((t) => t.parentId)!;
    await f.ai.savePolicy({ ...f.policy, capabilities: [] });
    f.ai.approve(child.id, child.pending!.id, true);
    await until(
      () =>
        !['running', 'approval'].includes(
          f.ai.snapshot().threads.find((t) => t.id === child.id)!.state,
        ),
    );
    assert.equal(f.executions(), 0);
    await f.ai.stopAndSave(f.thread.id);
    await f.idle();
    assert.ok(
      f.ai.snapshot().threads.every((t) => t.state !== 'running' && t.state !== 'approval'),
    );
  } finally {
    await f.cleanup();
  }
});

test('run deadline releases a pending approval without executing it', async () => {
  const f = await setup(() => call('execute_command', { command: 'await review' }), 1000);
  try {
    await f.ai.mode(f.thread.id, 'review');
    await f.ai.send(f.thread.id, 'check');
    await until(() => !!f.ai.snapshot().threads[0].pending);
    await f.idle();
    assert.equal(f.executions(), 0);
    assert.equal(f.ai.snapshot().threads[0].pending, undefined);
    assert.equal(f.ai.snapshot().threads[0].state, 'error');
  } finally {
    await f.cleanup();
  }
});

test('three active children limit and parent stop also cancel pending child approvals', async () => {
  let allocated = 0;
  const f = await setup((req) => {
    const task = req.messages.find((m: any) => m.role === 'user')?.content;
    if (task === 'inspect child') return call('execute_command', { command: 'inspect' });
    const last = req.messages.at(-1);
    if (last.role === 'tool' && last.content.startsWith('Error:'))
      return { content: 'concurrency bounded' };
    allocated++;
    return call('spawn_agent', { task: 'inspect child' });
  });
  try {
    await f.ai.mode(f.thread.id, 'restricted');
    await f.ai.send(f.thread.id, 'coordinate');
    await f.idle();
    await until(() =>
      f.ai.snapshot().threads.every((t) => !['running', 'approval'].includes(t.state)),
    );
    assert.equal(allocated, 4);
    assert.equal(f.ai.snapshot().threads.filter((t) => t.parentId === f.thread.id).length, 3);
    assert.equal(f.executions(), 0);
    assert.ok(f.ai.snapshot().threads.every((t) => !t.pending));
  } finally {
    await f.cleanup();
  }
});

test('goals do not overlap, complete on report, persist and stop on missing connection', async () => {
  let outcome = 'continue';
  const f = await setup((req) =>
    req.messages.at(-1).role === 'tool'
      ? { content: 'check summary' }
      : call('report_goal', {
          status: outcome,
          summary: 'Observed candidate status and timestamps',
        }),
  );
  try {
    await f.ai.saveGoal(f.thread.id, {
      objective: 'check stopped containers',
      intervalMinutes: 15,
    });
    assert.equal(f.ai.snapshot().threads[0].goal!.intervalMinutes, 15);
    await Promise.all([f.ai.work.tick(Date.now() + 1000000), f.ai.work.tick(Date.now() + 1000000)]);
    await f.idle();
    let goal = f.ai.snapshot().threads[0].goal!;
    assert.equal(goal.runs, 1);
    assert.equal(goal.state, 'active');
    assert.ok(goal.nextRun);
    const restored = new AiService(f.directory, f.store, f.registry);
    await restored.load();
    assert.equal(restored.snapshot().threads[0].goal!.state, 'blocked');
    assert.equal(restored.snapshot().threads[0].goal!.nextRun, undefined);
    outcome = 'complete';
    await f.ai.goalAction(f.thread.id, 'run');
    await f.idle();
    goal = f.ai.snapshot().threads[0].goal!;
    assert.equal(goal.state, 'complete');
    const count = f.requests.length;
    await f.ai.work.tick(Date.now() + 99999999);
    assert.equal(f.requests.length, count);
    await f.ai.goalAction(f.thread.id, 'resume');
    f.disconnect();
    await f.ai.work.tick(Date.now() + 1000000);
    assert.equal(f.ai.snapshot().threads[0].goal!.state, 'blocked');
    assert.equal(f.requests.length, count);
  } finally {
    await f.cleanup();
  }
});

test('a final goal report ends the batch before later actions; failed save cannot schedule a goal', async () => {
  const f = await setup(() => ({
    content: null,
    tool_calls: [
      ...call('report_goal', { status: 'complete', summary: 'Observed completion' }).tool_calls,
      ...call('execute_command', { command: 'must not execute after completion' }).tool_calls,
    ],
  }));
  try {
    const encrypt = f.store.encryptPrivate.bind(f.store);
    f.store.encryptPrivate = async () => {
      throw new Error('storage unavailable');
    };
    await assert.rejects(f.ai.saveGoal(f.thread.id, { objective: 'check' }), /storage/);
    assert.equal(f.ai.snapshot().threads[0].goal, undefined);
    f.store.encryptPrivate = encrypt;
    await f.ai.saveGoal(f.thread.id, { objective: 'check' });
    await f.ai.goalAction(f.thread.id, 'run');
    await f.idle();
    assert.equal(f.ai.snapshot().threads[0].goal!.state, 'complete');
    assert.equal(f.executions(), 0);
  } finally {
    await f.cleanup();
  }
});

test('goals require explicit capability, block without a report, pause persists, interval is bounded', async () => {
  const f = await setup(() => ({ content: 'no goal status' }));
  try {
    await assert.rejects(f.ai.saveGoal(f.thread.id, { objective: 'check', intervalMinutes: 0 }));
    await f.ai.savePolicy(emptyAiPolicy());
    await assert.rejects(f.ai.saveGoal(f.thread.id, { objective: 'check' }), /权限/);
    await f.ai.savePolicy(f.policy);
    await f.ai.saveGoal(f.thread.id, { objective: 'check' });
    await f.ai.goalAction(f.thread.id, 'run');
    await f.idle();
    assert.equal(f.ai.snapshot().threads[0].goal!.state, 'blocked');
    await f.ai.goalAction(f.thread.id, 'resume');
    await f.ai.stopAndSave(f.thread.id);
    const restored = new AiService(f.directory, f.store, f.registry);
    await restored.load();
    assert.equal(restored.snapshot().threads[0].goal!.state, 'paused');
  } finally {
    await f.cleanup();
  }
});
