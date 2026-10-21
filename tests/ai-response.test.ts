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
