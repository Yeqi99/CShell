import { AgentRelayService } from '../../src/agent/relay';
import { ClientVault, fingerprint } from '../../src/core/client/identity';
import { agentCodec } from '../../src/agent/storage';

// Dedicated service, identity and encrypted state; no terminal or agent runtime loaded.
async function main(){
const directory = process.env.RELAY_DATA || '/var/lib/cshell-relay';
const vault = new ClientVault(directory, await agentCodec(directory));
const identity = await vault.identity();
const secret = process.env.RELAY_AUTH_TOKEN;
if (!secret) throw Error('Missing local authorization credential');
const relay = new AgentRelayService({
  vault,
  identity,
  authorize: async (input) => {
    const response = await fetch('http://127.0.0.1:8789/v1/admin/relay/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Relay-Token': secret },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    return response.ok && (await response.json()).allowed === true;
  },
});
await relay.load();
await relay.configure({
  enabled: true,
  bind: '0.0.0.0',
  port: Number(process.env.RELAY_PORT || 22444),
  targets: [],
  maxConnections: 128,
  maxBytesPerTunnel: 1024 ** 3,
  bytesPerSecond: 16 * 1024 ** 2,
  idleTimeoutMs: 300000,
});
await relay.start();
console.log(
  'CShell account relay ready; certificate SHA256 ' +
    fingerprint(identity.certificate).replaceAll(':', '').toLowerCase(),
);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => void relay.stop().then(() => process.exit(0)));

}
void main().catch(()=>{console.error("Cloud relay startup failed");process.exitCode=1;});
