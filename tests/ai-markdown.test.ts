import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiMarkdown } from '../src/ui/components/AiMarkdown';
const render = (text: string) => renderToStaticMarkup(createElement(AiMarkdown, { text }));
test('agent markdown renders Chinese emphasis, GFM tables, lists and inline code', () => {
  const html = render(
    '目前只有 **1 个已保存目标**。\n\n| 名称 | 状态 |\n|---|---|\n| 测试服务器 | 已连接 |\n\n- **说明**：`pwd`\n- 第二项',
  );
  assert.match(html, /<strong>1 个已保存目标<\/strong>/);
  assert.match(html, /<table>/);
  assert.match(html, /<th>名称<\/th>/);
  assert.match(html, /<td>已连接<\/td>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<code>pwd<\/code>/);
});
test('agent markdown keeps code whitespace and tolerates partial streamed fences', () => {
  for (const text of ['```sh\n  pwd\n', '```sh\n  pwd\n```']) {
    assert.match(render(text), /<pre>  pwd<\/pre>/);
    assert.match(render(text), /复制内容/);
  }
  for (const text of ['**尚未', '| 名称 |', '| 名称 |\n|---|\n| 当前'])
    assert.doesNotThrow(() => render(text));
});
test('agent markdown does not execute HTML or load remote images or unsafe URLs', () => {
  const html = render(
    '<script>alert(1)</script>\n\n<img src="https://example.com/pixel" onerror="bad()">\n\n![说明](https://example.com/pixel)\n\n[危险](javascript:alert%281%29)',
  );
  assert.doesNotMatch(html, /<script|<img|onerror|href="javascript:/i);
  assert.match(html, /说明/);
});
