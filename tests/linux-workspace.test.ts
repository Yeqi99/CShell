import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visualInput, LinuxVisualApps } from '../src/agent/linux-visual-apps';
import { linuxWorkspaceMethods } from '../src/shared/linux-workspace';
import { agentManageInput } from '../src/core/api/agent-inputs';
import { linuxBrowserInstall } from '../src/agent/linux-browser-install';

test('visual input rejects arbitrary key commands, forged window IDs and out-of-bounds coordinates', () => {
  for (const input of [
    { type: 'click', x: -1, y: 0 },
    { type: 'click', x: 1440, y: 0 },
    { type: 'window', id: '0x1; touch /tmp/x' },
    { type: 'key', key: 'exec /bin/sh' },
    { type: 'shortcut', key: 'Terminal' },
    { type: 'text', text: 'hello', command: 'sh' },
  ])
    assert.equal(visualInput.safeParse(input).success, false);
  assert.equal(
    visualInput.safeParse({ type: 'text', text: '中文 $(touch /tmp/no)' }).success,
    true,
  );
  assert.equal(visualInput.safeParse({ type: 'window', id: '0x00400001' }).success, true);
});
test('SSH workspace cannot change credentials, listen addresses or relay grants', () => {
  for (const method of [
    'client.access',
    'connection.save',
    'client.start',
    'relay.start',
    'packages.invoke',
    'assistant.configure',
  ])
    assert.equal(linuxWorkspaceMethods.has(method), false);
  for (const method of [
    'visual.status',
    'visual.launch',
    'visual.frame',
    'visual.input',
    'visual.close',
  ])
    assert.equal(agentManageInput.safeParse({ method }).success, false);
});
test('visual sessions fail closed without an owned display and reject arbitrary applications', async () => {
  const service = new LinuxVisualApps();
  await assert.rejects(service.frame('foreign-owner'), /未运行/);
  await assert.rejects(service.input('foreign-owner', { type: 'key', key: 'Enter' }), /未运行/);
  await assert.rejects(service.launch('owner', { app: '/bin/sh' }));
  await service.dispose();
});
test('browser installation preserves Chromium sandbox and does not open X11 network ports', () => {
  assert.ok(linuxBrowserInstall.includes('signed-by='));
  assert.ok(linuxBrowserInstall.includes('xvfb'));
  assert.ok(linuxBrowserInstall.includes('openbox'));
  assert.ok(!linuxBrowserInstall.includes('--no-sandbox'));
  assert.ok(!linuxBrowserInstall.includes('ufw'));
  assert.ok(!linuxBrowserInstall.includes('sudo'));
});
