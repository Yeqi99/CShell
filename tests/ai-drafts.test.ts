import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiDrafts } from '../src/core/ai-drafts';

const codec = {
  async encryptPrivate(text: string) { return Buffer.from(text).toString('base64'); },
  async decryptPrivate(text: string) { return Buffer.from(text, 'base64').toString(); },
};
test('draft writes remain ordered, recover independently and cleared text stays cleared', async () => {
  const path = await mkdtemp(join(tmpdir(), 'draft-test-'));
  try {
    const drafts = new AiDrafts(path, codec); await drafts.load();
    await Promise.all([drafts.save('thread-a', 'private draft A'), drafts.save('thread-b', 'B'), drafts.save('thread-a', '')]);
    assert.deepEqual(await drafts.snapshot(), { 'thread-b': 'B' });
    assert.ok(!(await readFile(join(path, 'ai-drafts.enc'), 'utf8')).includes('thread-b'));
    const restored = new AiDrafts(path, codec); await restored.load();
    assert.deepEqual(await restored.snapshot(), { 'thread-b': 'B' });
    assert.throws(() => restored.save('__proto__', 'bad'));
    assert.throws(() => restored.save('thread-a', 'x'.repeat(100001)));
    assert.deepEqual(await restored.snapshot(), { 'thread-b': 'B' });
  } finally { await rm(path, { recursive: true, force: true }); }
});
test('draft corruption is reported and original encrypted bytes are preserved', async () => {
  const path = await mkdtemp(join(tmpdir(), 'draft-test-'));
  try {
    await writeFile(join(path, 'ai-drafts.enc'), 'broken');
    await assert.rejects(new AiDrafts(path, codec).load());
    assert.equal(await readFile(join(path, 'ai-drafts.enc'), 'utf8'), 'broken');
  } finally { await rm(path, { recursive: true, force: true }); }
});
