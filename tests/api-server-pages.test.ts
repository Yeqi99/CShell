import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ServerPages, serverPageOutput } from '../src/core/api/server-pages';

test('connection pages bind caller, policy, visible directory and search without retaining snapshots', () => {
  const pages = new ServerPages();
  const visible = Array.from({ length: 6 }, (_, i) => ({
    id: randomUUID(),
    name: `node ${i}`,
    host: 'localhost',
    port: 22,
    username: 'user',
    protocol: 'ssh' as const,
  }));
  const first = pages.page('one', 1, visible, { limit: 2 });
  assert.equal(first.total, 6);
  assert.equal(first.remaining, 4);
  assert.ok(first.nextCursor);
  assert.ok(serverPageOutput.safeParse(first).success);
  const second = pages.page('one', 1, visible, { limit: 2, cursor: first.nextCursor });
  assert.equal(new Set([...first.items, ...second.items].map((p) => p.id)).size, 4);
  for (const [owner, generation, list, query] of [
    ['two', 1, visible, ''],
    ['one', 2, visible, ''],
    ['one', 1, visible.slice(1), ''],
    ['one', 1, visible, 'node'],
  ] as const) {
    assert.throws(
      () => pages.page(owner, generation, [...list], { query, cursor: first.nextCursor }),
      { code: 'CURSOR_EXPIRED' },
    );
  }
  assert.equal(pages.page('one', 1, visible, { query: 'NODE 2' }).total, 1);
  assert.throws(() => pages.page('one', 1, visible, { cursor: first.nextCursor + 'x' }), {
    code: 'CURSOR_EXPIRED',
  });
  const bounded = pages.page('one', 1, visible, { budgetBytes: 700 });
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 700);
  assert.ok(bounded.remaining > 0);
  assert.throws(
    () => pages.page('one', 1, [{ ...visible[0], name: 'x'.repeat(1000) }], { budgetBytes: 512 }),
    { code: 'BUDGET_TOO_SMALL' },
  );
  const expired = new ServerPages();
  assert.throws(() => expired.page('one', 1, visible, { cursor: first.nextCursor }), {
    code: 'CURSOR_EXPIRED',
  });
});
