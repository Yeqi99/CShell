import assert from 'node:assert/strict';
import { databaseHost, databasePort, installDatabase } from '../src/agent/database-apps';
import { isDatabaseApp } from '../src/shared/database-apps';

const app = process.env.APP || '';
if (!isDatabaseApp(app) || process.env.GITHUB_ACTIONS !== 'true') {
  throw Error('Run in an ephemeral Actions runner with APP set to the database under test');
}
const signal = AbortSignal.timeout(20 * 60 * 1000);
const host = await databaseHost(signal);
const project = 'cagent-smoke-' + app;
for (const port of [32181, 32182]) {
  await installDatabase(host, project, app, port, signal, console.log);
  assert.equal(await databasePort(host, project, app, signal), port);
}
