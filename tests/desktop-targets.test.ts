import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { DesktopTargets } from '../src/core/desktop-targets';
import { DesktopViews } from '../src/core/desktop-views';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
test('whole network outage loses active terminal but desktop reauthenticates pinned paired device', async () => {
  let active = true,
    online = true,
    enabled = true;
  const deviceId = randomUUID(),
    session = randomUUID(),
    id = randomUUID();
  let devices = [{ deviceId, fingerprint: 'original-pin' }];
  const targets = new DesktopTargets({
    active: (target) => (active && target === session ? { resourceId: deviceId } : undefined),
    devices: () => devices,
  });
  targets.bind(id, session);
  assert.throws(() => targets.bind(randomUUID(), deviceId), /已连接/);
  const clients: any[] = [],
    events: any[] = [],
    opened: string[] = [];
  const views = new DesktopViews({
    retryDelays: [550, 100],
    authorize: (target) => {
      if (!enabled) throw new Error('plugin disabled');
      targets.resolve(target);
    },
    onStopped: (id) => targets.release(id),
    publish: (e) => events.push(e),
    open: async (input) => {
      opened.push(targets.resolve(input.target));
      if (!online) throw Object.assign(new Error('offline'), { code: 'ECONNREFUSED' });
      return {
        ticket: { control: false } as any,
        host: 'test',
        identity: deviceId,
        local: false,
        close: async () => {},
      };
    },
    connect: async () => {
      const c = Object.assign(new EventEmitter(), {
        releaseInput() {},
        async close() {},
        requestKeyframe() {},
        ack() {},
        reportDecode() {},
      });
      clients.push(c);
      return c as any;
    },
  });
  try {
    await views.start({
      id,
      target: session,
      quality: { fps: 60, bitrate: 12000000, display: 0, adaptive: true },
    });
    // Terminal and desktop sockets disappear together. The 500ms guard must not revoke.
    active = false;
    online = false;
    clients[0].emit('closed', 'CONTROL_CLOSED');
    await sleep(560);
    assert.equal(events.at(-1).state, 'reconnecting');
    assert.equal(targets.resolve(session), deviceId);
    online = true;
    await sleep(150);
    assert.equal(clients.length, 2);
    assert.deepEqual(opened, [deviceId, deviceId, deviceId]);
    devices = [{ deviceId, fingerprint: 'different-pin' }];
    await sleep(520);
    assert.equal(events.at(-1).type, 'closed');
    assert.throws(() => targets.resolve(session));
  } finally {
    await views.dispose();
  }
});
test('explicit close, deletion and release permanently invalidate captured binding', () => {
  const deviceId = randomUUID();
  let active = true,
    devices = [{ deviceId, fingerprint: 'pin' }];
  const targets = new DesktopTargets({
    active: () => (active ? { resourceId: deviceId } : undefined),
    devices: () => devices,
  });
  targets.bind('view', 'session');
  active = false;
  assert.equal(targets.resolve('session'), deviceId);
  assert.deepEqual(targets.stopTarget('session'), ['view']);
  assert.throws(() => targets.resolve('session'));
  assert.throws(() => targets.bind('new', 'session'));
  active = true;
  targets.bind('next', 'session');
  devices = [];
  assert.throws(() => targets.resolve('session'));
  targets.release('next');
});
