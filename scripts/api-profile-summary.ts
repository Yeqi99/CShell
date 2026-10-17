import { readFile, writeFile } from 'node:fs/promises';

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
}

// Exclusive sample attribution, not CPU accounting or request-stage latency.
// The benchmark process also contains its HTTP clients and SSH fixture servers.
const input = process.argv[2] ?? 'test-results/api-protocol.cpuprofile';
const profile = JSON.parse(await readFile(input, 'utf8')) as {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
};
if (profile.samples.length !== profile.timeDeltas.length)
  throw new Error('CPU profile samples and time deltas do not match');
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const totals = new Map<
  string,
  { function: string; source: string; line: number; sampledMs: number }
>();
let totalMs = 0;
let negativeTimeDeltas = 0;
for (let index = 0; index < profile.samples.length; index++) {
  const node = nodes.get(profile.samples[index]);
  if (!node) throw new Error('CPU profile references a missing node');
  const rawDelta = profile.timeDeltas[index] / 1000;
  if (!Number.isFinite(rawDelta)) throw new Error('Invalid profile time delta');
  if (rawDelta < 0) negativeTimeDeltas++;
  const elapsed = Math.max(0, rawDelta);
  const frame = node.callFrame;
  const key = JSON.stringify([frame.functionName, frame.url, frame.lineNumber]);
  const entry = totals.get(key) ?? {
    function: frame.functionName || '(anonymous)',
    source: frame.url,
    line: frame.lineNumber + 1,
    sampledMs: 0,
  };
  entry.sampledMs += elapsed;
  totalMs += elapsed;
  totals.set(key, entry);
}
const result = {
  input,
  scope:
    'Exclusive sampled wall time, including idle, startup, clients and fixture servers. Sampling adds overhead. Not per-request latency or production CPU utilization.',
  samples: profile.samples.length,
  negativeTimeDeltas,
  timeDeltaPolicy: 'Negative clock deltas contribute zero duration and are counted above.',
  totalSampledMs: totalMs,
  top: [...totals.values()]
    .sort((a, b) => b.sampledMs - a.sampledMs)
    .slice(0, 40)
    .map((entry) => ({
      ...entry,
      percentOfSamples: totalMs ? (100 * entry.sampledMs) / totalMs : 0,
    })),
};
await writeFile(`${input}.summary.json`, JSON.stringify(result, null, 2));
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
