import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiTextService } from '../src/core/ai-text';
import { translationChunks, analysisDraft } from '../src/ui/text-assist';
import { AiMarkdown } from '../src/ui/components/AiMarkdown';
import { AiToolRecord } from '../src/ui/components/AiToolRecord';

test('CJK strong renders while inline/fenced code and escaped markers remain literal', () => {
  const html = renderToStaticMarkup(
    createElement(AiMarkdown, {
      text: '- **名称**: 1\n\n但目前**没有已建立的会话**，当前未授权。\n\n`**代码**`\n\n\\*\\*字面\\*\\*\n\n```text\n**代码块**\n```',
    }),
  );
  assert.match(html, /<strong>名称<\/strong>/);
  assert.match(html, /<strong>没有已建立的会话<\/strong>/);
  assert.match(html, /<code>\*\*代码\*\*<\/code>/);
  assert.doesNotMatch(html, /<strong>(字面|代码块)/);
});
test('tool record hides empty arguments and distinguishes input from returned output', () => {
  const render = (input: string) =>
    renderToStaticMarkup(
      createElement(AiToolRecord, {
        message: {
          role: 'tool',
          time: 0,
          content: '',
          tool: { name: 'list_sessions', input, output: '{"sessions":[]}' },
        },
      }),
    );
  assert.doesNotMatch(render('{}'), />输入</);
  assert.match(render('{}'), />返回</);
  assert.match(render('{"path":"/root"}'), />输入</);
});
test('incremental translation reuses stable blocks and never drops long lines', () => {
  const text = Array.from({ length: 40 }, (_, i) => 'line ' + i).join('\n');
  const before = translationChunks(text),
    after = translationChunks(text + '\nnew output');
  assert.equal(before[0], after[0]);
  assert.equal(before[1], after[1]);
  assert.equal(after[2], 'new output');
  assert.equal(translationChunks('x'.repeat(15000)).join(''), 'x'.repeat(15000));
});
test('analysis draft uses UI language and leaves the next line ready for the question', () => {
  assert.equal(
    analysisDraft(' selected text ', 'zh-CN'),
    'selected text\n\n以上是当前我想咨询的相关情况，我的问题：\n',
  );
  assert.match(analysisDraft('output', 'en-US'), /My question is:\n$/);
});
test('translation cache deduplicates requests, separates language/model and rejects tool output', async () => {
  const calls: any[] = [];
  let invalid = false;
  const api = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    calls.push(body);
    const kind = JSON.parse(body.messages[1].content).kind;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          {
            message: invalid
              ? {
                  content: 'bad',
                  tool_calls: [
                    { id: 'x', type: 'function', function: { name: 'execute', arguments: '{}' } },
                  ],
                }
              : { content: kind === 'translate' ? '翻译结果' : '["第一项","第二项","第三项"]' },
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  const service = new AiTextService(),
    provider = {
      id: 'test',
      model: 'model',
      key: 'private-key',
      url: `http://127.0.0.1:${(api.address() as any).port}/v1`,
    };
  try {
    const input = { kind: 'translate', text: 'output' };
    const results = await Promise.all([
      service.request(provider, input),
      service.request(provider, input),
    ]);
    assert.equal(results[0].text, '翻译结果');
    assert.equal(calls.length, 1);
    await service.request(provider, input);
    assert.equal(calls.length, 1);
    await service.request(provider, { ...input, language: 'en' });
    assert.equal(calls.length, 2);
    await service.request({ ...provider, model: 'other' }, input);
    assert.equal(calls.length, 3);
    const composed = await service.request(provider, {
      kind: 'compose',
      text: '查目录',
      ideas: ['只读'],
      context: 'shell',
    });
    assert.equal(composed.choices.length, 3);
    assert.ok(calls.every((c) => !c.tools && c.stream));
    invalid = true;
    await assert.rejects(
      service.request(provider, { kind: 'translate', text: 'unseen' }),
      /可用内容/,
    );
  } finally {
    await new Promise<void>((r) => api.close(() => r()));
  }
});
