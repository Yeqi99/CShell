import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Diagnostics, diagnosticText } from '../src/core/diagnostics';

test('diagnostics redact credentials and URL content without serializing arbitrary objects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-diagnostics-'));
  const log = new Diagnostics(directory, 'test');
  log.record('ipc.connect', new Error('password=hunter2 Bearer abc.def https://user:pass@host/private?token=hidden sk-secretkey'));
  log.record('ipc.body', { password: 'never-serialize-me' });
  const data = await readFile(join(log.directory, 'runtime.jsonl'), 'utf8');
  for (const secret of ['hunter2', 'abc.def', 'user:pass', 'private?', 'token=hidden', 'sk-secretkey', 'never-serialize-me']) assert(!data.includes(secret), secret);
  assert(data.includes('ipc.connect'));
  assert(data.includes('Unknown error'));
  assert(!diagnosticText('-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----').includes('secret'));
});

test('diagnostics rotate bounded files, rate limit error storms, and tolerate disk errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-diagnostics-'));
  const log = new Diagnostics(directory, 'test', 1000);
  for (let i = 0; i < 200; i++) log.record('test', 'x'.repeat(300) + i);
  const files = await readdir(log.directory);
  assert.equal(files.length, 4);
  const content = (await Promise.all(files.map(file => readFile(join(log.directory, file), 'utf8')))).join('');
  // Inspect messages, not ISO timestamps whose milliseconds can contain 199.
  const messages = content.trim().split('\n').map(line => JSON.parse(line).message);
  assert(messages.includes('x'.repeat(300) + '119'));
  assert(!messages.includes('x'.repeat(300) + '199'));
  const invalid = join(directory, 'file'); await writeFile(invalid, 'not a directory');
  assert.doesNotThrow(() => new Diagnostics(invalid, 'test').record('disk', new Error('failure')));
});
