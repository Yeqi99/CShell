import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HostingService } from '../src/agent/hosting';
import { hostingConfigSchema } from '../src/shared/agent-hosting';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-hosting-'));
  const service = new HostingService(directory);
  await service.load();
  return {
    service,
    directory,
    close: async () => {
      await service.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
const config = () =>
  hostingConfigSchema.parse({
    id: randomUUID(),
    name: '测试服务',
    routes: [{ method: 'GET', path: '/', body: '你好' }],
  });

test('hosting persists without auto-start and enforces lifecycle and explicit external binding', async () => {
  const f = await fixture();
  try {
    const input = config();
    assert.equal(input.host, '127.0.0.1');
    assert.equal((await f.service.save(input)).running, false);
    await assert.rejects(f.service.save({ ...input, host: '0.0.0.0' }), /对外监听/);
    await assert.rejects(
      f.service.save({ ...input, routes: [...input.routes, ...input.routes] }),
      /重复/,
    );
    const saved = new HostingService(f.directory);
    await saved.load();
    assert.equal(saved.list()[0].running, false);
    assert.deepEqual(saved.list()[0].config, { ...input, revision: 1 });
    await saved.dispose();
    const started = await f.service.start(input.id, { expectedRevision: 1 });
    assert.ok(started.actualPort);
    assert.equal(
      started.environment,
      process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux',
    );
    assert.equal(await (await fetch(`http://127.0.0.1:${started.actualPort}/`)).text(), '你好');
    await assert.rejects(f.service.save(input), /先停止/);
    await assert.rejects(f.service.remove(input.id), /先停止/);
    assert.equal((await f.service.stop(input.id)).running, false);
    await f.service.remove(input.id);
    assert.equal(f.service.list().length, 0);
  } finally {
    await f.close();
  }
});

test('hosting callback previews, request bodies and history are bounded', async () => {
  const f = await fixture();
  try {
    const input = config();
    input.routes = [{ ...input.routes[0], method: 'POST', mode: 'callback' }];
    await f.service.save(input);
    const { actualPort } = await f.service.start(input.id, { expectedRevision: 1 });
    const url = `http://127.0.0.1:${actualPort}/`;
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          body: 'x'.repeat(5000),
          headers: { authorization: 'secret' },
        })
      ).status,
      200,
    );
    let logs = f.service.logs(input.id);
    assert.equal(logs[0].body?.length, 4096);
    assert.equal(logs[0].truncated, true);
    assert.ok(!JSON.stringify(logs).includes('secret'));
    for (let i = 0; i < 20; i++)
      await (await fetch(url, { method: 'POST', body: 'x'.repeat(4096) })).text();
    assert.ok(Buffer.byteLength(JSON.stringify(f.service.logs(input.id))) <= 65536);
    assert.equal((await fetch(url, { method: 'POST', body: 'x'.repeat(65537) })).status, 413);
    for (let i = 0; i < 105; i++)
      await (await fetch(url, { method: 'POST', body: String(i) })).text();
    logs = f.service.logs(input.id);
    assert.equal(logs.length, 100);
    assert.equal(logs.at(-1)?.body, '104');
  } finally {
    await f.close();
  }
});

test('hosting code requires authorization, runs in a child and validates response headers', async () => {
  const f = await fixture();
  try {
    const input = config();
    input.routes = [
      {
        ...input.routes[0],
        mode: 'code',
        code: 'return {status:201, body:JSON.stringify({pid:process.pid, body:request.body}), headers:{"content-type":"application/json"}}',
      },
      {
        ...input.routes[0],
        path: '/bad',
        mode: 'code',
        code: 'return {headers:{"x-invalid":"one\\r\\ntwo"},body:"bad"}',
      },
      {
        ...input.routes[0],
        path: '/throw',
        mode: 'code',
        code: 'throw new Error("expected failure")',
      },
    ];
    await f.service.save(input);
    await assert.rejects(f.service.start(input.id, { expectedRevision: 1 }), /明确代码执行授权/);
    assert.equal(f.service.list()[0].running, false);
    const { actualPort } = await f.service.start(input.id, {
      allowCode: true,
      expectedRevision: 1,
    });
    const base = `http://127.0.0.1:${actualPort}`;
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 201);
    const result = (await response.json()) as { pid: number };
    assert.notEqual(result.pid, process.pid);
    assert.throws(() => process.kill(result.pid, 0));
    assert.equal((await fetch(`${base}/bad`)).status, 500);
    assert.equal((await fetch(`${base}/throw`)).status, 500);
    assert.match(f.service.logs(input.id).at(-1)?.error ?? '', /expected failure/);
  } finally {
    await f.close();
  }
});

test('hosting stop cancels a running worker and releases listening socket', async () => {
  const f = await fixture();
  try {
    const input = config();
    input.routes = [{ ...input.routes[0], mode: 'code', code: 'while(true) {}' }];
    await f.service.save(input);
    const { actualPort } = await f.service.start(input.id, {
      allowCode: true,
      expectedRevision: 1,
    });
    const response = fetch(`http://127.0.0.1:${actualPort}/`).then(
      (r) => r.status,
      () => 0,
    );
    // Synchronize with the actual worker, not a sleep that can expire before fetch arrives.
    const active = (f.service as any).active.get(input.id);
    const until = Date.now() + 5000;
    while (!active.children.size && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(active.children.size, 1);
    const worker = [...active.children][0] as import('node:child_process').ChildProcess;
    const originalKill = (f.service as any).kill.bind(f.service);
    const terminations: Promise<void>[] = [];
    (f.service as any).kill = (child: import('node:child_process').ChildProcess) => {
      const result = originalKill(child); terminations.push(result); return result;
    };
    const start = Date.now();
    await f.service.stop(input.id);
    assert.ok(Date.now() - start < 4000);
    assert.ok(terminations.length >= 2, 'abort and service stop both request termination');
    assert.equal(terminations[0], terminations[1], 'concurrent termination shares one OS operation');
    assert.ok(worker.exitCode !== null || worker.signalCode !== null, 'stop waits for actual process exit');
    assert.equal(active.children.size, 0);
    assert.ok([0, 504].includes(await response));
    assert.equal(f.service.list()[0].running, false);
    await assert.rejects(fetch(`http://127.0.0.1:${actualPort}/`));
    assert.match(f.service.logs(input.id).at(-1)?.error ?? '', /取消/);
  } finally {
    await f.close();
  }
});

test('hosting failed bind is visible and does not claim running', async () => {
  const f = await fixture();
  try {
    const input = config();
    await f.service.save(input);
    const started = await f.service.start(input.id, { expectedRevision: 1 });
    const second = { ...input, id: randomUUID(), port: started.actualPort! };
    await f.service.save(second);
    await assert.rejects(f.service.start(second.id, { expectedRevision: 1 }), /EADDRINUSE/);
    const result = f.service.list().find((s) => s.config.id === second.id)!;
    assert.equal(result.running, false);
    assert.match(result.error!, /EADDRINUSE/);
  } finally {
    await f.close();
  }
});

test('hosting terminates hung code and excessive output without stopping the service', async context => {
  const f = await fixture();
  try {
    const input = config();
    input.routes = [
      { ...input.routes[0], mode: 'code', code: 'while(true) {}' },
      {
        ...input.routes[0],
        path: '/output',
        mode: 'code',
        code: 'console.log("x".repeat(70000)); await new Promise(()=>{});',
      },
      { ...input.routes[0], path: '/body', mode: 'code', code: 'return "x".repeat(70000)' },
      { ...input.routes[0], path: '/ok' },
    ];
    await f.service.save(input);
    const { actualPort } = await f.service.start(input.id, {
      allowCode: true,
      expectedRevision: 1,
    });
    const base = `http://127.0.0.1:${actualPort}`;
    const termination: {durationMs:number;exited:boolean;failed:boolean}[]=[];
    const originalKill=(f.service as any).kill.bind(f.service);
    (f.service as any).kill=(child:import('node:child_process').ChildProcess)=>{
      const started=Date.now(),operation=originalKill(child) as Promise<void>;
      const record=(failed:boolean)=>termination.push({durationMs:Date.now()-started,exited:child.exitCode!==null||child.signalCode!==null,failed});
      void operation.then(()=>record(false),()=>record(true));return operation;
    };
    const began = Date.now();let previousTick=began,maxEventLoopDelayMs=0;
    const probe=setInterval(()=>{const now=Date.now();maxEventLoopDelayMs=Math.max(maxEventLoopDelayMs,now-previousTick-100);previousTick=now;},100);
    let elapsedMs=0;
    try {assert.equal((await fetch(base)).status, 500);}
    finally {
      elapsedMs=Date.now()-began;clearInterval(probe);
      context.diagnostic(JSON.stringify({elapsedMs,serverDurationMs:f.service.logs(input.id).at(-1)?.durationMs,maxEventLoopDelayMs,termination}));
    }
    assert.ok(elapsedMs < 9000,`hosting response exceeded 9s: ${elapsedMs}ms; see lifecycle diagnostic`);
    assert.match(f.service.logs(input.id).at(-1)?.error ?? '', /5 秒/);
    assert.equal((await fetch(`${base}/output`)).status, 500);
    assert.equal((await fetch(`${base}/body`)).status, 500);
    assert.equal(await (await fetch(`${base}/ok`)).text(), '你好');
  } finally {
    await f.close();
  }
});

test('hosting rejects stale edits and a start approved against an earlier revision', async () => {
  const f = await fixture();
  try {
    const input = config();
    const first = await f.service.save(input);
    const second = await f.service.save({
      ...first.config,
      routes: [{ ...first.config.routes[0], body: 'changed' }],
    });
    assert.equal(second.config.revision, 2);
    await assert.rejects(f.service.save(first.config), /配置已改变/);
    await assert.rejects(f.service.start(input.id, { expectedRevision: 1 }), /配置已改变/);
    assert.equal(f.service.list()[0].running, false);
    const started = await f.service.start(input.id, { expectedRevision: 2 });
    assert.equal(await (await fetch(`http://127.0.0.1:${started.actualPort}/`)).text(), 'changed');
  } finally {
    await f.close();
  }
});
