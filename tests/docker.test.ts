import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture';
import { SshService } from '../src/core/ssh';
import { DockerService, parseDockerStats } from '../src/core/docker';
import { dockerActionSchema, toolsSettingsSchema } from '../src/shared/docker';
import { suggestCommands, shellPromptInput } from '../src/ui/command-suggestions';

test('command suggestions only append known prefixes and never return executable control sequences', () => {
  assert.equal(suggestCommands('doc')[0].command, 'docker ps');
  assert.equal(suggestCommands('sudo sys')[0].command, 'sudo systemctl status ');
  for (const input of ['ls;rm', 'a\n', '$(id)', 'docker |', '', 'unknown-command'])
    assert.deepEqual(suggestCommands(input), []);
  assert.equal(shellPromptInput('root@server:~# doc'), 'doc');
  assert.equal(shellPromptInput('Password: '), null);
  assert.equal(shellPromptInput('GNU nano'), null);
});
test('Docker input schemas reject shell-like IDs, invalid or duplicate ports and unknown access settings', () => {
  assert.throws(() => dockerActionSchema.parse({ type: 'start', id: 'a; reboot' }));
  assert.throws(() =>
    toolsSettingsSchema.parse({ dockerEnabled: true, dockerSocket: 'tcp://server:2375' }),
  );
  const p = { host: '127.0.0.1', hostPort: 8080, containerPort: 80, protocol: 'tcp' };
  assert.throws(() =>
    dockerActionSchema.parse({ type: 'ports', id: 'a'.repeat(64), ports: [p, p] }),
  );
  assert.equal(parseDockerStats({}).cpu, null);
});
test(
  'Docker Engine over authenticated SSH: inventory, stats, lifecycle, preserved recreation and rollback',
  { timeout: 30000 },
  async () => {
    const server = await fixture();
    const ssh = new SshService(
      () => {},
      async () => true,
    );
    try {
      const { sessionId } = await ssh.connect(
        {
          id: randomUUID(),
          name: 'Docker test',
          host: '127.0.0.1',
          port: server.port,
          username: 'tester',
          auth: 'password',
          favorite: false,
          group: '',
        },
        { password: server.password },
      );
      const docker = new DockerService(ssh, () => '/var/run/docker.sock');
      assert.equal((await docker.snapshot(sessionId)).containers.length, 2);
      const stats = await docker.stats(sessionId, server.docker.id);
      assert.equal(stats.cpu, 40);
      assert.equal(stats.memory, 41943040);
      await assert.rejects(
        docker.action(sessionId, { type: 'remove', id: server.docker.id }),
        /running/,
      );
      await docker.action(sessionId, { type: 'stop', id: server.docker.id });
      await docker.action(sessionId, { type: 'start', id: server.docker.id });
      const ports = [
        { host: '127.0.0.1' as const, hostPort: 9090, containerPort: 80, protocol: 'tcp' as const },
      ];
      const result = await docker.action(sessionId, { type: 'ports', id: server.docker.id, ports });
      const commitIndex = server.docker.calls.findIndex((c) => c.path.startsWith('/commit?'));
      assert.ok(server.docker.calls[commitIndex - 1].path.endsWith('/stop?t=10'));
      assert.ok(result.backup);
      assert.ok(result.snapshot);
      const next = server.docker.containers.get(result.id!);
      assert.equal(next.State.Running, true);
      assert.equal(next.HostConfig.PortBindings['80/tcp'][0].HostPort, '9090');
      assert.deepEqual(next.Config.Env, ['EXAMPLE=retained']);
      assert.deepEqual(next.HostConfig.Binds, ['/srv/site:/usr/share/nginx/html:ro']);
      assert.equal(next.HostConfig.Mounts[0].Source, 'retained-data');
      assert.equal(
        server.docker.containers.get(server.docker.id).HostConfig.RestartPolicy.Name,
        'no',
      );
      server.docker.failNextStart();
      await assert.rejects(
        docker.action(sessionId, { type: 'ports', id: result.id!, ports }),
        /Original container restored/,
      );
      assert.equal(server.docker.containers.get(result.id!).Name, '/web-app');
      assert.equal(server.docker.containers.get(result.id!).State.Running, true);
      assert.equal(
        server.docker.containers.get(result.id!).HostConfig.RestartPolicy.Name,
        'unless-stopped',
      );
      const creates = server.docker.calls.filter((c) => c.path.startsWith('/containers/create'));
      assert.equal(creates.length, 2);
      const separate = await docker.action(sessionId, {
        type: 'create',
        image: server.docker.image,
        name: 'test-created',
        ports: [],
        restart: 'no',
        start: true,
      });
      assert.equal(server.docker.containers.get(separate.id!).State.Running, true);
      await assert.rejects(new DockerService(ssh, () => '/wrong.sock').snapshot(sessionId));
      ssh.disconnect(sessionId);
      await new Promise((r) => setTimeout(r, 30));
      await assert.rejects(docker.snapshot(sessionId));
    } finally {
      ssh.dispose();
      await server.close();
    }
  },
);
