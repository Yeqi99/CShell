import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHardware, parseProcesses } from '../src/core/resource-inspection';
import { parseMetrics } from '../src/core/metrics';

test('resource inspection distinguishes GPU availability, preserves multiple devices and bounds process snapshots', () => {
  const hardware = parseHardware(
    '__NVIDIA__\nNVIDIA RTX 4090, 12, 400, 24564\nNVIDIA T4, N/A, 0, 15360\n__PCI__\n00:02.0 VGA compatible controller: Intel Graphics\n01:00.0 3D controller: NVIDIA RTX\n',
  );
  assert.equal(hardware.gpus.length, 3);
  assert.equal(hardware.gpus[0].utilization, 12);
  assert.equal(hardware.gpus[1].utilization, null);
  assert.equal(hardware.gpus[2].name, 'Intel Graphics');
  assert.equal(parseHardware('').status, 'unavailable');
  const processes = parseProcesses('  44 root 120.5 2.1 python3\n  55 alice 0.0 0.1 worker pool\n');
  assert.equal(processes.entries[0].cpu, 120.5);
  assert.equal(processes.entries[1].command, 'worker pool');
  assert.throws(() => parseProcesses('ps: unsupported'));
  const many = parseProcesses(
    Array.from({ length: 501 }, (_, i) => `${i + 1} user 1.0 0.0 task`).join('\n'),
  );
  assert.equal(many.entries.length, 500);
  assert.equal(many.truncated, true);
  assert.equal(parseMetrics('__MODEL__\nAMD EPYC 7763\n').cpuModel, 'AMD EPYC 7763');
});
