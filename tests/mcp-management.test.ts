import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { Store } from '../src/core/store';
import { McpService } from '../src/core/mcp';
import { apiClientSchema } from '../src/shared/contracts';
import { fixture } from './fixture';
test(
  'real API saved connections/trust/credentials and task/session recovery stay owner scoped',
  { timeout: 30000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cshell-mcp-management-')),
      f = await fixture({ execResult: { stdout: 'partial', stderr: 'failure', exitCode: 7 } });
    const store = new Store(dir, {
      encrypt: async (v) => Buffer.from(v).toString('base64'),
      decrypt: async (v) => Buffer.from(v, 'base64').toString(),
    });
    await store.load();
    let reviewAccepted = true;
    let onReview: (() => void) | undefined;
    const reviews: string[] = [];
    let account = {key:'account-a:0',transitioning:false};
    const svc = new McpService(store, dir, async (_name, detail) => {reviews.push(detail);onReview?.();return reviewAccepted;}, {accountContext:()=>account} as any);
    const socket = createServer();
    await new Promise<void>((r) => socket.listen(0, '127.0.0.1', r));
    const port = (socket.address() as { port: number }).port;
    await new Promise<void>((r) => socket.close(() => r()));
    const a = apiClientSchema.parse({
        id: randomUUID(),
        name: 'a',
        enabled: true,
        allowedProfiles: [],
        allowCommands: true,
        review: 'authorized',
        capabilities: [],
        disclosure: { mode: 'full', level: 'names', budgetBytes: 65536 },
        applicationCapabilities: [
          'connections.read',
          'connections.manage',
          'credentials.manage',
          'identity.trust',
        ],
      }),
      b = apiClientSchema.parse({
        id: randomUUID(),
        name: 'b',
        enabled: true,
        allowedProfiles: [],
        allowCommands: true,
        review: 'authorized',
        capabilities: [],
        disclosure: { mode: 'full', level: 'names', budgetBytes: 65536 },
      });
    try {
      await svc.configure({ ...store.mcpSettings(), enabled: true, port, clients: [a, b] });
      const at = await svc.accessToken(a.id),
        bt = await svc.accessToken(b.id);
      const call = async (name: string, args: unknown = {}, token = at) => {
        const r = await fetch(`http://127.0.0.1:${port}/api/v1/invoke`, {
          method: 'POST',
          headers: {
            Connection: 'close',
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name, arguments: args }),
        });
        return { status: r.status, ...((await r.json()) as any) };
      };
      assert.notEqual((await call('connection_create', {}, bt)).status, 200);
      const created = await call('connection_create', {
        profile: {
          name: 'managed',
          host: '127.0.0.1',
          port: f.port,
          username: 'tester',
          auth: 'password',
          group: '',
          favorite: false,
        },
        secret: { password: f.password },
      });
      assert.equal(created.status, 200, JSON.stringify(created));
      const id = created.result.profile.id;
      assert.ok(created.result.credentialConfigured);
      assert.ok(!JSON.stringify(created).includes(f.password));
      assert.notEqual((await call('connect', { profileId: id })).status, 200); // saving never grants connection scope
      a.allowedProfiles = [id];
      b.allowedProfiles = [id];
      await svc.configure({ ...store.mcpSettings(), clients: [a, b] });
      const probe = await call('connection_probe', { id });
      assert.equal(probe.status, 200, JSON.stringify(probe));
      assert.equal(f.authenticationRequests(), 0);
      assert.notEqual(
        (
          await call(
            'connection_accept',
            { challenge: probe.result.challenge, fingerprint: probe.result.fingerprint },
            bt,
          )
        ).status,
        200,
      );
      const accepted = await call('connection_accept', {
        challenge: probe.result.challenge,
        fingerprint: probe.result.fingerprint,
      });
      assert.equal(accepted.result.trusted, true);
      assert.equal(
        (await call('connection_preflight', { profileId: id })).result.hostIdentityTrusted,
        true,
      );
      const checked = await call('connection_preflight', { profileId: id, probe: true });
      assert.equal(checked.result.stages.authentication.outcome, 'ok');
      assert.equal(f.shellRequests(), 0);
      assert.equal(f.execRequests(), 0);
      a.targetPolicies = {[id]:{review:'always',allowCommands:true,capabilities:[]}};
      await svc.configure({...store.mcpSettings(), clients:[a,b]});
      reviewAccepted=false;
      const authBefore=f.authenticationRequests();
      for(const [name,args] of [
        ['connection_preflight',{profileId:id,probe:true}],
        ['connection_probe',{id}],
        ['connection_update',{id,revision:store.connectionRevision(id),patch:{name:'declined'}}],
        ['connection_credentials',{id,revision:store.connectionRevision(id),secret:{password:'never-log-this'}}],
      ] as const) assert.notEqual((await call(name,args)).status,200,name);
      assert.equal(f.authenticationRequests(),authBefore);
      assert.equal(store.profile(id).name,'managed');
      assert.equal(reviews.length,4);
      assert.ok(!reviews.join('').includes('never-log-this'));
      assert.ok(reviews[2].includes('declined'));
      reviewAccepted=true;
      const reviewedProbe=await call('connection_probe',{id});
      reviewAccepted=false;
      assert.notEqual((await call('connection_accept',{challenge:reviewedProbe.result.challenge,fingerprint:reviewedProbe.result.fingerprint})).status,200);
      assert.equal(reviews.length,6);
      reviewAccepted=true;
      onReview=()=>{account={key:'account-a:1',transitioning:true};svc.invalidateAccountContext();};
      assert.notEqual((await call('connection_credentials',{id,revision:store.connectionRevision(id),secret:{password:'must-not-save'}})).status,200);
      assert.equal((await store.secret(id))?.password,f.password);
      assert.notEqual((await call('connection_list')).status,200);
      account={key:'account-a:2',transitioning:false};onReview=undefined;
      (svc as any).host=undefined;
      a.targetPolicies={};
      await svc.configure({...store.mcpSettings(),clients:[a,b]});
      const connected = await call('connect', { profileId: id });
      assert.equal(connected.status, 200, JSON.stringify(connected));
      const sessionId = connected.result.sessionId;
      assert.equal((await call('session_list')).result.sessions[0].sessionId, sessionId);
      assert.deepEqual((await call('session_list', {}, bt)).result.sessions, []);
      const outcome = await call('execute_command', { sessionId, command: 'fail' });
      assert.equal(outcome.result.exitCode, 7);
      assert.equal(outcome.result.stderr, 'failure');
      assert.equal(outcome.result.stdout, 'partial');
      const task = await call('task_start', {
        sessionId,
        tool: 'execute_command',
        arguments: { command: 'fail' },
        idempotencyKey: 'recover-once',
      });
      assert.equal(task.status, 200, JSON.stringify(task));
      const tasks = await call('task_list');
      assert.equal(tasks.result.tasks[0].taskId, task.result.taskId);
      assert.deepEqual((await call('task_list', {}, bt)).result.tasks, []);
      const diag = await call('permission_diagnostics', { profileId: id });
      assert.ok(diag.result.application.includes('credentials.manage'));
      await svc.stop();
      const audit = await readFile(join(dir, 'mcp-audit.jsonl'), 'utf8');
      assert.ok(!audit.includes(f.password));
    } finally {
      await svc.stop();
      f.disconnectAll();
      await f.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
