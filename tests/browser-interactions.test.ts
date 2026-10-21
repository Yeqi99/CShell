import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserSuggestions, browserPagePermission } from '../src/core/browser-interactions';
test('address suggestions match title and URL, deduplicate and stay bounded', () => {
  const a = { url: 'https://example.test/a', title: '项目文档', at: '2026-10-21' },
    b = { url: 'https://other.test/', title: 'Other', at: '2026-10-20' };
  assert.deepEqual(browserSuggestions('文档', [a, b], [a]), [a]);
  assert.deepEqual(browserSuggestions('other', [a, b], [a]), [b]);
  assert.equal(browserSuggestions('', [a, b], [a]).length, 2);
  assert.equal(browserSuggestions('missing', [a], [b]).length, 0);
});
test('only active-page clipboard writes and fullscreen are allowed, clipboard reads remain denied', () => {
  for (const p of ['clipboard-sanitized-write', 'fullscreen']) {
    assert.equal(browserPagePermission(p, true), true);
    assert.equal(browserPagePermission(p, false), false);
  }
  for (const p of ['clipboard-read', 'media', 'geolocation', 'unknown'])
    assert.equal(browserPagePermission(p, true), false);
});
