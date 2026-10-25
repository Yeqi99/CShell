import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  OfficialOpenCode,
  ensureOfficialRuntime,
} from '../src/extensions/opencode/official-runtime';

// Explicit integration check: requires the genuine npm archive, never user credentials.
const archivePath =
  process.env.CSHELL_OPENCODE_TEST_ARCHIVE ?? '.local/opencode-official/package.tgz';
const directory = await mkdtemp(join(tmpdir(), 'cshell-official-integration-'));
try {
  const archive = await readFile(resolve(archivePath));
  let downloads = 0;
  const executable = await ensureOfficialRuntime(directory, async (url) => {
    assert.match(String(url), /^https:\/\/registry\.npmjs\.org\/opencode-/);
    downloads++;
    return new Response(archive);
  });
  assert.equal(
    await ensureOfficialRuntime(directory, async () => {
      throw Error('Must reuse verified runtime');
    }),
    executable,
  );
  assert.equal(downloads, 1);
  let requests = 0,
    mode: 'answer' | 'cancel' | 'denied' = 'answer';
  let controller: AbortController | undefined;
  const network: typeof fetch = async (url, init) => {
    if (String(url) === 'https://models.dev/api.json') return new Response(null, { status: 503 });
    requests++;
    assert.equal(String(url), 'https://opencode.ai/inference/go/openai/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-secret');
    assert.match(new Headers(init?.headers).get('user-agent') ?? '', /^opencode\/1\.19\.4 /);
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(
      body.tools.map((t: any) => t.function.name),
      ['StructuredOutput'],
    );
    if (mode === 'cancel') {
      controller!.abort();
      init?.signal?.throwIfAborted();
      throw Error('Unreachable');
    }
    if (mode === 'denied')
      return Response.json(
        { error: { message: 'FreeTier only OpenCode allowed' } },
        { status: 403 },
      );
    const reply = {
      content: '',
      tool_calls: [{ name: 'read_machine', arguments: '{"field":"cpu"}' }],
    };
    const events = [
      {
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'StructuredOutput', arguments: JSON.stringify(reply) },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 5, completion_tokens: 10 },
      },
    ];
    return new Response(
      events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join('') +
        'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  };
  const client = new OfficialOpenCode(directory, network, async () => executable);
  const diagnostic = setInterval(() => console.log(JSON.stringify(client.status())), 10000);
  diagnostic.unref();
  const input = {
    tier: 'go' as const,
    model: 'beam-free',
    key: 'fixture-secret',
    guard: () => {},
    body: {
      model: 'beam-free',
      max_tokens: 512,
      messages: [{ role: 'user', content: 'Read CPU information' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_machine',
            parameters: {
              type: 'object',
              properties: { field: { type: 'string' } },
              required: ['field'],
            },
          },
        },
      ],
    },
  };
  const result = await (
    await client.request({ ...input, signal: AbortSignal.timeout(60000) })
  ).json();
  assert.equal(requests, 1);
  assert.equal(result.choices[0].message.tool_calls[0].function.name, 'read_machine');
  assert.deepEqual(await readdir(join(directory, 'official-sessions')), []);
  mode = 'cancel';
  // Application shutdown also owns configuration probes outside AiService tasks.
  const closing = new OfficialOpenCode(
    directory,
    async (url, init) => {
      if (String(url) === 'https://models.dev/api.json') return new Response(null, { status: 503 });
      void closing.dispose();
      init?.signal?.throwIfAborted();
      throw Error('Shutdown must cancel inference');
    },
    async () => executable,
  );
  await assert.rejects(closing.request({ ...input, signal: AbortSignal.timeout(60000) }));
  await closing.dispose();
  assert.equal(closing.status().active, 0);
  assert.deepEqual(await readdir(join(directory, 'official-sessions')), []);
  mode = 'cancel';
  controller = new AbortController();
  await assert.rejects(() =>
    client.request({
      ...input,
      signal: AbortSignal.any([controller!.signal, AbortSignal.timeout(60000)]),
    }),
  );
  assert.equal(requests, 2);
  assert.deepEqual(await readdir(join(directory, 'official-sessions')), []);
  assert.equal(client.status().active, 0);
  mode = 'denied';
  const denied = await client.request({ ...input, signal: AbortSignal.timeout(60000) });
  assert.equal(denied.status, 403);
  assert.equal(
    requests,
    3,
    'official retries cannot forward a second inference or replay an operation',
  );
  assert.match((await denied.json()).error.message, /FreeTier/);
  assert.deepEqual(await readdir(join(directory, 'official-sessions')), []);
  clearInterval(diagnostic);
  console.log(
    'PASS genuine OpenCode 1.19.4: archive hash, private runtime, authenticated local API, only StructuredOutput, one model request, tool handoff, cancel cleanup, rejection/no retry',
  );
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
