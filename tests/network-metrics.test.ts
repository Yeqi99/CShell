import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNetworkMetrics } from '../src/core/network-metrics';
import { parseProcessNetwork, processNetworkCommand } from '../src/core/process-network';
import { networkMetricsSchema } from '../src/shared/network-metrics';
function fixture(time: number, rx: number, tx: number, name = 'eth0') {
  return `__NETWORK__\n${time} 0\nInter-| Receive | Transmit\n ${name}: ${rx} 10 1 2 0 0 0 0 ${tx} 20 3 4 0 0 0 0\n__NETWORK_END__\n`;
}
test('network rates use remote monotonic interval, first sample is unknown', () => {
  const first = parseNetworkMetrics(fixture(100, 1000, 2000));
  assert.equal(first.network.interfaces[0].receivePerSecond, null);
  const second = parseNetworkMetrics(fixture(105, 6120, 12240), first.sample);
  assert.equal(second.network.status, 'ready');
  assert.equal(second.network.interfaces[0].receivePerSecond, 1024);
  assert.equal(second.network.interfaces[0].sendPerSecond, 2048);
  assert.equal(second.network.interfaces[0].rxDropped, 2);
  assert.equal(second.network.interfaces[0].txErrors, 3);
  networkMetricsSchema.parse(second.network);
});
test('missing, stale, restarted counters and new interfaces never fabricate zero traffic', () => {
  const before = parseNetworkMetrics(fixture(100, 1000, 2000)).sample;
  for (const input of [
    fixture(99, 2000, 3000),
    fixture(140, 2000, 3000),
    fixture(105, 1, 1),
    fixture(105, 3000, 3000, 'new0'),
  ]) {
    assert.equal(parseNetworkMetrics(input, before).network.interfaces[0].receivePerSecond, null);
  }
  assert.equal(parseNetworkMetrics('missing', before).network.status, 'unavailable');
  assert.deepEqual(
    parseNetworkMetrics('__NETWORK__\n10 0\neth0: NaN\n__NETWORK_END__').network.interfaces,
    [],
  );
});
test('NetHogs sample keeps latest refresh and actual directional KiB/s rates', () => {
  const result = parseProcessNetwork(
    'Refreshing:\n/usr/bin/old/10/0\t99\t99\nRefreshing:\n/usr/bin/curl/25/1000\t1.5\t2\nunknown TCP/0/0\t0\t0\n',
  );
  assert.equal(result.status, 'ready');
  assert.equal(result.entries[0].name, 'curl');
  assert.equal(result.entries[0].pid, 25);
  assert.equal(result.entries[0].sendPerSecond, 1536);
  assert.equal(result.entries[0].receivePerSecond, 2048);
  assert.equal(parseProcessNetwork('__MISSING_NETHOGS__').status, 'missing-tool');
  assert.equal(parseProcessNetwork('Refreshing:\n__UNAVAILABLE__').status, 'unavailable');
  assert.equal(parseProcessNetwork('permission denied').status, 'unavailable');
  assert.deepEqual(parseProcessNetwork('Refreshing:\n').entries, []);
  assert.match(processNetworkCommand, /timeout -k 1 5/);
  assert.doesNotMatch(processNetworkCommand, /sudo|apt|yum|dnf/);
});
