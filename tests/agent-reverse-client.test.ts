import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createAgentRuntime } from '../src/agent/runtime';
import { agentCodec } from '../src/agent/storage';
import { ClientVault, createIdentity, fingerprint } from '../src/core/client/identity';
import { ClientProvider } from '../src/core/client/provider';
import type { AgentRelayStatus, AgentReverseRelayStatus } from '../src/shared/agent-relay';

async function port() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const result = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return result;
}
async function until(check: () => boolean | Promise<boolean>, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for reverse Agent state');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

test(
  'ClientProvider pairs and opens a real native PTY through an outbound-only Agent with end-to-end pinning',
  { timeout: 45000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cshell-reverse-native-'));
    const relayRuntime = await createAgentRuntime({ directory: join(directory, 'relay') });
    const targetRuntime = await createAgentRuntime({ directory: join(directory, 'target') });
    const controllerDir = join(directory, 'controller');
    let output = '';
    const controller = new ClientProvider(
      new ClientVault(controllerDir, await agentCodec(controllerDir)),
      (event) => {
        if (event.type === 'data') {
          output += event.data;
          try {
            controller.resolve(event.sessionId).terminal!.acknowledge(event.data.length);
          } catch {}
        }
      },
    );
    let sessionId: string | undefined;
    try {
      await controller.load();
      const shell = process.platform === 'win32' ? 'cmd' : 'sh';
      const targetPort = await port();
      const password = 'reverse-native-test-password';
      await targetRuntime.dispatch('client.access', { password, shells: [shell] });
      await targetRuntime.dispatch('client.start', { bind: '127.0.0.1', port: targetPort });
      const relayPort = await port();
      await relayRuntime.dispatch('relay.configure', {
        enabled: true,
        bind: '127.0.0.1',
        port: relayPort,
        targets: [{ id: 'outbound-B', mode: 'reverse' }],
      });
      await relayRuntime.dispatch('relay.start', undefined);
      const relayStatus = (await relayRuntime.dispatch(
        'relay.status',
        undefined,
      )) as AgentRelayStatus;
      assert.equal(relayStatus.config.targets[0].host, '');
      const relay = {
        host: '127.0.0.1',
        port: relayPort,
        fingerprint: relayStatus.fingerprint,
        targetId: 'outbound-B',
        credential: (await relayRuntime.dispatch('relay.revealCredential', undefined)) as string,
      };
      const registration = (await relayRuntime.dispatch('relay.registrationCredential', {
        targetId: 'outbound-B',
      })) as string;
      await targetRuntime.dispatch('relay.reverse.configure', {
        enabled: true,
        relay: { ...relay, credential: registration },
        localPort: targetPort,
      });
      await targetRuntime.dispatch('relay.reverse.start', undefined);
      await until(
        async () =>
          (
            (await targetRuntime.dispatch(
              'relay.reverse.status',
              undefined,
            )) as AgentReverseRelayStatus
          ).connected,
      );
      const info = await controller.probe({ host: 'b-outbound-only.invalid', port: 22443, relay });
      assert.equal(info.deviceId, targetRuntime.server.status().deviceId);
      assert.equal(fingerprint(info.certificate), targetRuntime.server.status().fingerprint);
      const impostor = await createIdentity();
      await assert.rejects(
        controller.pairPassword({ ...info, certificate: impostor.certificate }, password),
        /identity|身份|certificate|证书/i,
      );
      assert.equal(
        targetRuntime.server.status().peers.length,
        0,
        'wrong target pin must fail before password authentication',
      );
      const device = await controller.pairPassword(info, password);
      assert.equal(device.host, 'b-outbound-only.invalid');
      assert.ok(!JSON.stringify(controller.list()).includes(relay.credential));
      assert.ok(
        !(await readFile(join(controllerDir, 'devices.enc'), 'utf8')).includes(relay.credential),
      );
      sessionId = await controller.connect(
        { deviceId: device.deviceId, shell },
        undefined,
        new AbortController().signal,
      );
      assert.equal(targetRuntime.terminal.size, 1);
      controller.resolve(sessionId).terminal!.input('echo CSHELL_REVERSE_NATIVE_OK\r');
      // ConPTY can move the cursor to the next prompt instead of emitting a newline.
      // Require the result at the start of a line, so the echoed command cannot satisfy it.
      const resultLine =
        /(?:^|\n)(?:\x1b\[[0-?]*[ -/]*[@-~])*CSHELL_REVERSE_NATIVE_OK(?=\r|\n|\x1b|$)/;
      await until(() => resultLine.test(output));
      assert.match(output, resultLine);
      assert.equal(targetRuntime.terminal.size, 1, 'native shell remains persistent after output');
      await relayRuntime.dispatch('relay.rotateRegistrationCredential', { targetId: 'outbound-B' });
      await until(() => targetRuntime.terminal.size === 0);
      await until(() => {
        try {
          controller.resolve(sessionId!);
          return false;
        } catch {
          return true;
        }
      });
      await assert.rejects(
        controller.probe({ host: 'b-outbound-only.invalid', port: 22443, relay }),
      );
    } finally {
      if (sessionId) controller.disconnect(sessionId);
      await targetRuntime.close();
      await relayRuntime.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
