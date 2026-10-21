import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LinuxWorkspaceService } from '../src/core/linux-workspace';
import { linuxWorkspaceInstallScript } from '../src/core/linux-workspace-install';
const mock = (missing = '') => {
  const service = new LinuxWorkspaceService({ get: () => ({}) } as any, 'unused');
  const calls: string[] = [];
  service.jobs.exec = (async (_: string, cmd: string) => {
    calls.push(cmd);
    return calls.length === 1
      ? 'Linux\nx86_64\nalice\nmissing\nv20.20.2\n10.8.2\n' + missing
      : '/data/cagent\n/dev/data 1.7T 947G 619G 61% /data\n';
  }) as any;
  return { service, calls };
};
test('NodeSource Node20 and non-root user can plan isolated installation on a data disk', async () => {
  const { service } = mock();
  const p = await service.plan('session', '/data/cagent');
  assert.equal(p.user, 'alice');
  assert.equal(p.installDirectory, '/data/cagent');
  assert.match(p.diskInfo, /619G/);
  assert.ok(p.steps.some((s) => s.includes('v20.20.2')));
  await assert.rejects(service.install('other-session', p.id), /失效/);
});
test('invalid directories and missing build tools stop before any upload or package changes', async () => {
  for (const path of ['/', '////', 'relative', '/data/../etc', '/data\n/etc']) {
    const { service, calls } = mock();
    await assert.rejects(service.plan('s', path));
    assert.equal(calls.length, 0);
  }
  const { service, calls } = mock('missing:g++');
  await assert.rejects(service.plan('s', '/data/cagent'), /不会修改系统/);
  assert.equal(calls.length, 2);
});
test('installer quotes custom paths and confines dependency environment to installation subshell', () => {
  const script = linuxWorkspaceInstallScript(
    'x86_64',
    'a'.repeat(64),
    '/tmp/payload',
    "/data/agent's dir",
  );
  assert.ok(script.includes("base='/data/agent'\\''s dir'"));
  assert.doesNotMatch(script, /apt-get|sudo |npm install -g|\.bashrc|\.profile/);
  const launcher = script.split("<<'CAGENT_LAUNCHER'\n")[1].split('\nCAGENT_LAUNCHER')[0];
  assert.doesNotMatch(launcher, /export PATH/);
  assert.match(launcher, /CSHELL_AGENT_DATA/);
  assert.match(script, /安装目录必须为空/);
  assert.match(script, /node-pty integrity mismatch/);
});
