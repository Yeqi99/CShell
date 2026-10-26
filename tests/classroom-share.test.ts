import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassroomShareService, parseClassroomAnnouncement, sameClassroomLan } from '../src/desktop/classroom-share';
import type { NetworkInterfaceInfo } from 'node:os';
import { createServer, request } from 'node:http';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const announcement = { protocol: 'cshell-classroom-v1', kind: 'share', id: 'a'.repeat(32), token: 'b'.repeat(64), label: '机房教师', port: 47884 };
const wire = (value: unknown) => Buffer.from(JSON.stringify(value));
const interfaces = { test: [{ address: '192.168.17.2', netmask: '255.255.255.0', family: 'IPv4', internal: false } as NetworkInterfaceInfo] };

test('discovery accepts only bounded source metadata and actual local IPv4 subnet', () => {
  assert.equal(sameClassroomLan('192.168.17.9', interfaces), true);
  for (const ip of ['192.168.18.9', '8.8.8.8', '127.0.0.1', '::1', '0.0.0.0']) assert.equal(sameClassroomLan(ip, interfaces), false);
  assert.equal(parseClassroomAnnouncement(wire(announcement), '192.168.17.9', 123)?.lastSeen, 123);
  for (const value of [{ ...announcement, port: 80 }, { ...announcement, token: 'secret' }, { ...announcement, label: '\nmalicious' }, { ...announcement, label: 'x'.repeat(61) }, { ...announcement, id: {} }]) {
    assert.equal(parseClassroomAnnouncement(wire(value), '192.168.17.9', 123), null);
  }
  assert.equal(parseClassroomAnnouncement(Buffer.alloc(1025), '192.168.17.9', 123), null);
});

type Internals = {
  sharing: { id: string; label: string; screenId: string; port: number } | null;
  sources: Map<string, ReturnType<typeof parseClassroomAnnouncement>>;
  discovering: boolean;
  allowed(address: string): boolean;
  token: string;
  bindDiscoverySocket(): Promise<void>;
  currentFrame(): Promise<{ jpeg: Buffer }>;
};
test('disabled initial state never captures; unsupported platform never claims support', async () => {
  let count = 0;
  const service = new ClassroomShareService({ platform: 'linux', capture: { screens: async () => [], capture: async () => { count++;return jpeg; } } });
  assert.deepEqual(await service.status(), { supported: false, sharing: null, discovering: false, sources: [], error: null });
  await assert.rejects(service.setDiscovery(true), /Windows/);await assert.rejects(service.screens(), /Windows/);assert.equal(count, 0);
  await service.dispose();
});
test('64 simultaneous viewers share one capture; stop rejects in-flight capture and clears cached picture', async () => {
  let count = 0;let finish!: (jpeg: Buffer) => void;
  const service = new ClassroomShareService({ platform: 'win32', capture: { screens: async () => [{ id: 'screen', name: 'screen' }], capture: async () => { count++;return new Promise<Buffer>(resolve => { finish = resolve; }); } } });
  const state = service as unknown as Internals;
  state.sharing = { id: 'a', label: 'teacher', screenId: 'screen', port: 47884 };
  const pending = Array.from({ length: 64 }, () => state.currentFrame());
  assert.equal(count, 1);finish(jpeg);await Promise.all(pending);
  await state.currentFrame();assert.equal(count, 1);
  await service.stop();await assert.rejects(state.currentFrame(), /停止/);
  state.sharing = { id: 'b', label: 'teacher', screenId: 'screen', port: 47884 };
  const interrupted = state.currentFrame();await service.stop();finish(jpeg);
  await assert.rejects(interrupted, /停止/);await service.dispose();
});
test('capture preflight failure exposes local error and never opens sharing', async () => {
  const service = new ClassroomShareService({ platform: 'win32', capture: { screens: async () => [{ id: 'screen', name: 'screen' }], capture: async () => { throw new Error('Capture unavailable'); } } });
  await assert.rejects(service.start({ screenId: 'screen', label: 'teacher' }), /Capture unavailable/);
  assert.equal((await service.status()).sharing, null);assert.equal((await service.status()).error, 'Capture unavailable');await service.dispose();
});
test('teacher endpoint serves only current read-only token and stop immediately closes listener', async () => {
  const service = new ClassroomShareService({ platform: 'win32', capture: { screens: async () => [{ id: 'screen', name: 'screen' }], capture: async () => jpeg } });
  const state = service as unknown as Internals;
  // Suppress LAN discovery entirely; synthetic JPEG only, no desktop capture.
  state.bindDiscoverySocket = async () => {};state.allowed = address => address === '127.0.0.1';
  const started = await service.start({ screenId: 'screen', label: 'fixture' });assert(started.sharing);
  const port = started.sharing.port, token = state.token;
  const read = (path: string, method = 'GET') => new Promise<number>((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, path, method }, response => { response.resume();response.on('end', () => resolve(response.statusCode!)); });r.on('error', reject);r.end();
  });
  try {
    assert.equal(await read('/frame/' + token), 200);
    assert.equal(await read('/frame/' + token, 'POST'), 404);
    assert.equal(await read('/frame/wrong'), 404);
    assert.equal(await read('/input'), 404);
    await service.stop();assert.equal(state.token, '');await assert.rejects(read('/frame/' + token));
  } finally { await service.dispose(); }
});
test('student frames use only discovered endpoint, no redirect following, no arbitrary URL and disabled discovery revokes access', async () => {
  const server = createServer((req, res) => {
    if (req.url !== '/frame/' + announcement.token) { res.writeHead(404).end();return; }
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });res.end(jpeg);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();assert(address && typeof address !== 'string');
  const service = new ClassroomShareService({ platform: 'win32' });const state = service as unknown as Internals;
  // Isolated loopback fixture; production subnet guard remains tested separately.
  state.allowed = () => true;state.discovering = true;
  state.sources.set(announcement.id, parseClassroomAnnouncement(wire({ ...announcement, port: address.port }), '127.0.0.1', Date.now()));
  try {
    assert.equal((await service.frame(announcement.id)).dataUrl, 'data:image/jpeg;base64,' + jpeg.toString('base64'));
    await assert.rejects(service.frame('http://example.invalid/'), /离线/);
    await service.setDiscovery(false);await assert.rejects(service.frame(announcement.id), /离线/);
  } finally { await service.dispose();server.closeAllConnections();await new Promise<void>(resolve => server.close(() => resolve())); }
});
