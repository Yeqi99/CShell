import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAiResponse } from '../src/core/ai-response';
function response(parts: string[]) {
  const bytes = new TextEncoder().encode(parts.join(''));
  return new Response(
    new ReadableStream({
      start(c) {
        for (const byte of bytes) c.enqueue(Uint8Array.of(byte));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
const event = (delta: unknown, finish: unknown = null) =>
  'data: ' + JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] }) + '\r\n\r\n';
test('token-sized reasoning events with over 2 MB of SSE envelopes preserve the completed tool call', async () => {
  const fragments = 12000;
  const packet = 'data: ' + JSON.stringify({
    id: 'chat-completion-id', model: 'deepseek', object: 'chat.completion.chunk', created: 1,
    choices: [{ index: 0, delta: { reasoning_content: '想' }, finish_reason: null }],
    usage: null,
  }) + '\n\n';
  const tail = event({tool_calls: [{index:0,id:'only-call',type:'function',function:{name:'check',arguments:'{}'}}]}, 'tool_calls');
  const stream = packet.repeat(fragments) + tail;
  assert.ok(stream.length > 2_000_000);
  const reply = await readAiResponse(new Response(stream, {headers:{'content-type':'text/event-stream'}}), () => {});
  assert.equal(reply.reasoning_content?.length, fragments);
  assert.deepEqual(reply.tool_calls?.map(call=>call.id), ['only-call']);
});
test('unterminated oversized SSE frame cannot materialize a tool call', async () => {
  const response = new Response('data: ' + 'x'.repeat(2_000_001), {headers:{'content-type':'text/event-stream'}});
  await assert.rejects(readAiResponse(response, () => {}), /单次输出过大/);
});
test('SSE emits partial Unicode text and assembles fragmented tool arguments', async () => {
  const partial: string[] = [];
  const result = await readAiResponse(
    response([
      event({ content: '你' }),
      event({ content: '好', tool_calls: null }),
      event({
        tool_calls: [
          {
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'execute_command', arguments: '{"com' },
          },
        ],
      }),
      event({ tool_calls: [{ index: 0, function: { arguments: 'mand":"pwd"}' } }] }, 'tool_calls'),
      'data: [DONE]\n\n',
    ]),
    (t) => partial.push(t),
  );
  assert.deepEqual(partial, ['你', '你好']);
  assert.equal(result.tool_calls![0].function.arguments, '{"command":"pwd"}');
});
test('truncated streams and malformed tools cannot execute', async () => {
  await assert.rejects(
    readAiResponse(response([event({ content: 'partial' })]), () => {}),
    /中断/,
  );
  await assert.rejects(
    readAiResponse(response([event({ tool_calls: [{ index: 17 }] }, 'tool_calls')]), () => {}),
    /索引/,
  );
});

test('output limits and filtering are interruptions rather than successful completions', async () => {
  await assert.rejects(
    readAiResponse(response([event({ content: '先检查' }, 'length')]), () => {}),
    /长度上限/,
  );
  await assert.rejects(
    readAiResponse(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }),
      ),
      () => {},
    ),
    /长度上限/,
  );
  await assert.rejects(
    readAiResponse(response([event({}, 'content_filter')]), () => {}),
    /过滤/,
  );
});

test('malformed provider JSON identifies its phase without leaking response payloads', async () => {
  for (const [body, type, code] of [
    ['{"private-prompt":"SECRET', 'application/json', 'AI_RESPONSE_JSON_INVALID'],
    ['data: {"private-prompt":"SECRET\n\n', 'text/event-stream', 'AI_SSE_JSON_INVALID'],
  ]) {
    await assert.rejects(readAiResponse(new Response(body, {headers:{'content-type':type}}),()=>{}), error => {
      assert.match(String(error),new RegExp(code));assert.doesNotMatch(String(error),/SECRET|private-prompt/);return true;
    });
  }
  await assert.rejects(readAiResponse(new Response('null'),()=>{}),/AI_RESPONSE_SCHEMA_INVALID/);
  await assert.rejects(readAiResponse(new Response('{"choices":[{"message":{"tool_calls":42}}]}'),()=>{}),/AI_RESPONSE_SCHEMA_INVALID/);
  const parsed=await readAiResponse(new Response('{"choices":[{"message":{"content":"OK","tool_calls":null}}]}'),()=>{});
  assert.equal(parsed.content,'OK');assert.equal(parsed.tool_calls,null);
});

test('records one cumulative usage sample even when delivered after finish_reason', async () => {
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}\n\n',
    'data: [DONE]\n\n',
  ];
  const response = new Response(new ReadableStream({
    pull(controller) { const chunk = chunks.shift(); if(chunk) controller.enqueue(encoder.encode(chunk)); else controller.close(); },
  }), { headers: { 'content-type': 'text/event-stream' } });
  const samples: unknown[] = [];
  await readAiResponse(response, () => {}, undefined, usage => samples.push(usage));
  assert.deepEqual(samples, [{ input:5, output:3, total:8 }]);
});

test('inline MiniMax thinking never reaches streaming callbacks, including split tags', async () => {
  const snapshots: string[] = [];
  const reply = await readAiResponse(response([
    ...['<', 'thi', 'nk>', 'We need answer Chinese.', '</thi', 'nk>', '\n你好'].map(content => event({content})),
    event({}, 'stop'),
  ]), text => snapshots.push(text));
  assert.deepEqual(snapshots, ['你好']);
  assert.equal(reply.content, '你好');
  assert.equal(reply.reasoning_content, 'We need answer Chinese.');
});
test('JSON thinking is separated and unterminated thinking cannot execute tools', async () => {
  const reply = await readAiResponse(Response.json({choices:[{message:{content:'<think>private</think>你好'}}]}),()=>{});
  assert.equal(reply.content, '你好');
  assert.equal(reply.reasoning_content, 'private');
  await assert.rejects(readAiResponse(response([event({content:'<think>private'},'stop')]),()=>assert.fail('reasoning leaked')), /思考响应未完成/);
});
test('normal English and quoted think examples remain answers', async () => {
  for (const text of ['Hello', 'Example: <think>literal</think>']) {
    const reply = await readAiResponse(response([event({content:text},'stop')]),()=>{});
    assert.equal(reply.content,text);
  }
});
