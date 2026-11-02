import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { fixture } from './fixture';
import { probeSshHost } from '../src/core/api/connection-management';
import { preflightSsh } from '../src/core/api/connection-preflight';
test(
  'real SSH auth-only preflight distinguishes identity/password/network and never starts a channel',
  { timeout: 15000 },
  async () => {
    const f = await fixture(),
      p = {
        id: randomUUID(),
        name: 'probe',
        host: '127.0.0.1',
        port: f.port,
        username: 'tester',
        auth: 'password' as const,
        group: '',
        favorite: false,
      };
    const signal = new AbortController().signal;
    try {
      const pin = await probeSshHost(p);
      assert.equal(f.authenticationRequests(), 0);
      const unknown = await preflightSsh(p, undefined, { password: f.password }, () => {}, signal);
      assert.equal(unknown.stages.identity.outcome, 'untrusted');
      assert.equal(unknown.stages.authentication.checked, false);
      assert.equal(f.authenticationRequests(), 0);
      const changed = await preflightSsh(
        p,
        'SHA256:' + 'x'.repeat(43),
        { password: f.password },
        () => {},
        signal,
      );
      assert.equal(changed.stages.identity.outcome, 'changed');
      assert.equal(f.authenticationRequests(), 0);
      const missing = await preflightSsh(p, pin, undefined, () => {}, signal);
      assert.equal(missing.stages.authentication.outcome, 'missing_credentials');
      assert.equal(f.authenticationRequests(), 0);
      const wrong = await preflightSsh(p, pin, { password: 'wrong' }, () => {}, signal);
      assert.equal(wrong.stages.authentication.outcome, 'failed');
      assert.equal(wrong.reason, 'authentication_failed');
      assert.equal(f.authenticationRequests(), 1);
      const valid = await preflightSsh(p, pin, { password: f.password }, () => {}, signal);
      assert.equal(valid.reason, 'ready');
      assert.equal(valid.stages.authentication.outcome, 'ok');
      assert.equal(f.authenticationRequests(), 2);
      assert.equal(f.shellRequests(), 0);
      assert.equal(f.execRequests(), 0);
      assert.ok(!JSON.stringify(valid).includes(f.password));
      const jump = await preflightSsh(
        { ...p, jumpProfileId: randomUUID() },
        pin,
        { password: f.password },
        () => {},
        signal,
      );
      assert.equal(jump.reason, 'jump_transport_not_supported');
      assert.equal(jump.stages.network.checked, false);
      let checks = 0;
      await assert.rejects(
        preflightSsh(
          p,
          pin,
          { password: f.password },
          () => {
            if (++checks > 1) throw Error('revoked');
          },
          signal,
        ),
        /revoked/,
      );
      assert.equal(f.authenticationRequests(), 2);
      const sock = createServer();
      await new Promise<void>((r) => sock.listen(0, '127.0.0.1', r));
      const port = (sock.address() as { port: number }).port;
      await new Promise<void>((r) => sock.close(() => r()));
      const refused = await preflightSsh(
        { ...p, port },
        pin,
        { password: f.password },
        () => {},
        signal,
      );
      assert.equal(refused.stages.network.outcome, 'failed');
      assert.equal(refused.stages.authentication.checked, false);
    } finally {
      f.disconnectAll();
      await f.close();
    }
  },
);
