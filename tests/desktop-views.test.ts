import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { DesktopViews } from '../src/core/desktop-views';
import { h264Codec, desktopScanCode } from '../src/ui/desktop-keys';

function fixture() {
  const client = Object.assign(new EventEmitter(), {
    acks: [] as string[],
    keys: 0,
    closed: 0,
    ack(id: unknown) {
      this.acks.push(String(id));
    },
    requestKeyframe() {
      this.keys++;
    },
    async close() {
      this.closed++;
    },
    input() {},
    quality() {},
    releaseInput() {},
    reportDecode() {},
  });
  const events: any[] = [];
  let allowed = true,
    hostClosed = 0;
  const manager = new DesktopViews({
    authorize: () => {
      if (!allowed) throw new Error('revoked');
    },
    publish: (e) => events.push(e),
    open: async () => ({
      ticket: { control: false } as any,
      identity: 'test',
      host: '127.0.0.1',
      local: true,
      close: async () => {
        hostClosed++;
      },
    }),
    connect: async () => client as any,
  });
  return {
    manager,
    client,
    events,
    revoke: () => {
      allowed = false;
    },
    get hostClosed() {
      return hostClosed;
    },
  };
}
const request = () => ({
  id: randomUUID(),
  target: 'local',
  quality: { fps: 60, bitrate: 12000000, display: 0, adaptive: true },
  control: false,
});
test('viewer keeps one renderer frame, rejects stale ack and asks for recovery after skipped delta', async () => {
  const f = fixture(),
    r = request();
  try {
    await f.manager.start(r);
    f.client.emit('frame', { id: 1n, timestamp: 10n, key: true, data: Buffer.from([1]) });
    f.client.emit('frame', { id: 2n, timestamp: 20n, key: false, data: Buffer.from([2]) });
    assert.equal(f.events.filter((e) => e.type === 'frame').length, 1);
    assert.deepEqual(f.client.acks, ['2']);
    assert.equal(f.client.keys, 1);
    f.manager.ack(r.id, '999', true, 2);
    assert.deepEqual(f.client.acks, ['2']);
    f.manager.ack(r.id, '1', true, 2);
    assert.deepEqual(f.client.acks, ['2', '1']);
    assert.throws(() => f.manager.input(r.id, { kind: 'move', x: 4, y: 0 }));
    f.revoke();
    assert.throws(() => f.manager.input(r.id, { kind: 'key', code: 30, down: true }), /revoked/);
  } finally {
    await f.manager.dispose();
  }
  assert.equal(f.client.closed, 1);
  assert.equal(f.hostClosed, 1);
});
test('cancelling while ticket is created releases the eventual ticket without connecting', async () => {
  let resolve!: (value: any) => void,
    closed = 0,
    connections = 0;
  const m = new DesktopViews({
      authorize: () => {},
      publish: () => {},
      open: () => new Promise((r) => (resolve = r)),
      connect: async () => {
        connections++;
        throw new Error('unexpected');
      },
    }),
    r = request();
  const pending = m.start(r);
  await m.stop(r.id);
  resolve({
    ticket: {},
    host: '127.0.0.1',
    identity: 'x',
    local: true,
    close: async () => {
      closed++;
    },
  });
  await assert.rejects(pending, /取消/);
  assert.equal(closed, 1);
  assert.equal(connections, 0);
  await m.dispose();
});
test('H264 SPS derives codec and physical keys preserve extended scancodes', () => {
  assert.equal(h264Codec(new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0, 0x2a, 1])), 'avc1.64002a');
  assert.equal(h264Codec(new Uint8Array([0, 0, 1, 0x65, 2])), undefined);
  assert.equal(desktopScanCode('KeyA'), 0x1e);
  assert.equal(desktopScanCode('ArrowLeft'), 0x14b);
  assert.equal(desktopScanCode('unknown'), undefined);
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function reconnectFixture(delays = [5, 10]) {
  const clients: any[] = [],
    events: any[] = [],
    opens: any[] = [];
  let allowed = true,
    closeHosts = 0,
    failOpen: Error | undefined;
  const manager = new DesktopViews({
    retryDelays: delays,
    authorize: () => {
      if (!allowed) throw new Error('REVOKED');
    },
    publish: (e) => events.push(e),
    open: async (input) => {
      opens.push(structuredClone(input));
      if (failOpen) throw failOpen;
      return {
        ticket: { control: true } as any,
        identity: 'host',
        host: 'local',
        local: true,
        close: async () => {
          closeHosts++;
        },
      };
    },
    connect: async () => {
      const c = Object.assign(new EventEmitter(), {
        inputs: 0,
        releases: 0,
        closed: 0,
        ack() {},
        requestKeyframe() {},
        reportDecode() {},
        quality() {},
        input() {
          this.inputs++;
        },
        releaseInput() {
          this.releases++;
        },
        async close() {
          this.closed++;
          (this as unknown as EventEmitter).emit('closed', 'VIEWER_CLOSED');
        },
      });
      clients.push(c);
      return c as any;
    },
  });
  return {
    manager,
    clients,
    events,
    opens,
    revoke() {
      allowed = false;
    },
    fail(error: Error) {
      failOpen = error;
    },
    get closeHosts() {
      return closeHosts;
    },
  };
}
test('network reconnect obtains fresh ticket, keeps quality and rejects prior generation input and frames', async () => {
  const f = reconnectFixture(),
    r = request();
  try {
    await f.manager.start(r);
    f.manager.quality(r.id, { ...r.quality, fps: 90 }, 1);
    f.clients[0].emit('closed', 'CONTROL_CLOSED');
    assert.throws(() => f.manager.input(r.id, { kind: 'key', code: 30, down: true }, 1));
    await sleep(35);
    assert.equal(f.opens.length, 2);
    assert.equal(f.opens[1].quality.fps, 90);
    assert.equal(f.clients[0].releases, 1);
    assert.equal(f.closeHosts, 1);
    assert.throws(() => f.manager.input(r.id, { kind: 'key', code: 30, down: true }, 1), /代次/);
    f.manager.input(r.id, { kind: 'key', code: 30, down: true }, 2);
    assert.equal(f.clients[1].inputs, 1);
    const count = f.events.length;
    f.clients[0].emit('frame', { id: 1n, timestamp: 1n, key: true, data: Buffer.from([1]) });
    assert.equal(f.events.length, count);
    assert.ok(
      f.events.some((e) => e.type === 'state' && e.state === 'reconnecting' && e.generation === 2),
    );
  } finally {
    await f.manager.dispose();
  }
});
test('stop cancels scheduled reconnect and authorization failure never retries', async () => {
  const f = reconnectFixture([25]),
    r = request();
  await f.manager.start(r);
  f.clients[0].emit('closed', 'CONTROL_FAILURE');
  await f.manager.stop(r.id);
  await sleep(40);
  assert.equal(f.opens.length, 1);
  await f.manager.dispose();
  const g = reconnectFixture(),
    s = request();
  await g.manager.start(s);
  g.fail(new Error('permission denied'));
  g.clients[0].emit('closed', 'CONTROL_CLOSED');
  await sleep(35);
  assert.equal(g.opens.length, 2);
  assert.equal(g.events.at(-1).type, 'closed');
  await g.manager.dispose();
});
test('repeated short connections exhaust bounded retries; explicit revoke is terminal', async () => {
  const f = reconnectFixture([5, 5]),
    r = request();
  try {
    await f.manager.start(r);
    for (let i = 0; i < 3; i++) {
      f.clients.at(-1).emit('closed', 'CONTROL_CLOSED');
      await sleep(20);
    }
    assert.equal(f.opens.length, 3);
    assert.match(f.events.at(-1).reason, /自动重连已停止/);
  } finally {
    await f.manager.dispose();
  }
  const g = reconnectFixture(),
    s = request();
  await g.manager.start(s);
  g.clients[0].emit('closed', 'REVOKED');
  await sleep(20);
  assert.equal(g.opens.length, 1);
  await g.manager.dispose();
});
