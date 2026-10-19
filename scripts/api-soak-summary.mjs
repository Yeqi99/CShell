import { readFile, writeFile } from 'node:fs/promises';
const http = JSON.parse(await readFile('test-results/api-isolated-soak.json', 'utf8'));
const mcp = JSON.parse(await readFile('test-results/api-mcp-soak.json', 'utf8'));
const windows = JSON.parse(await readFile('test-results/api-isolated-soak-windows.json', 'utf8'));
const percentile = (v, p) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) * p)];
const range = (rows, key) => ({
  first: rows[0][key],
  last: rows.at(-1)[key],
  min: Math.min(...rows.map((r) => r[key])),
  max: Math.max(...rows.map((r) => r[key])),
});
const lastHalf = windows.slice(Math.floor(windows.length / 2));
const result = {
  measuredAt: new Date().toISOString(),
  http: {
    elapsedMs: http.elapsedMs,
    rounds: http.rounds.length,
    operations: http.rounds.length * 276,
    warmupOperations: 24,
    concurrency: 12,
    owners: 3,
    targets: 2,
    revocations: http.lifecycle.length,
    maxRevokeReconnectMs: Math.max(...http.lifecycle.map((r) => r.revokeReconnectMs)),
    medianRoundP95Ms: percentile(
      http.rounds.map((r) => r.mixed.p95Ms),
      0.5,
    ),
    worstRoundP95Ms: Math.max(...http.rounds.map((r) => r.mixed.p95Ms)),
    worstRoundEventLoopP99Ms: Math.max(...http.rounds.map((r) => r.mixed.eventLoopP99Ms)),
    remainingConnections: http.remainingConnections,
  },
  mcp: { ...mcp, samples: undefined },
  windows: {
    sampleCount: windows.length,
    handles: range(windows, 'handles'),
    privateBytes: range(windows, 'privateBytes'),
    workingSet: range(windows, 'workingSet'),
    lastHalfHandles: range(lastHalf, 'handles'),
    lastHalfPrivateBytes: range(lastHalf, 'privateBytes'),
  },
  limitations: [
    'Loopback fixture services; not multiple physical machines or production user settings',
    'Memory/CPU include clients, fixtures, audit and test result retention',
    '15-minute HTTP and 10-minute MCP runs do not establish multi-hour leak freedom',
    'MCP long run covers metadata discovery/invocation; SSH/SFTP long run uses HTTP API',
    'No native desktop terminal input latency measurement in this run',
  ],
};
await writeFile('test-results/api-soak-closeout-summary.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
