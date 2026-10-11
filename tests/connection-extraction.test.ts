import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { extractConnection } from '../src/core/connection-extraction';
test('AI extraction is bounded structured data, never tool execution', async () => {
  let output: unknown = {
    providerId: 'cshell.ssh',
    fields: { host: 'example.test', port: 2222, username: 'developer' },
  };
  let tool = false,
    status = 200,
    requests: any[] = [];
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    requests.push(JSON.parse(text));
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(output),
              ...(tool ? { tool_calls: [{ name: 'execute_command' }] } : {}),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const provider = {
    url: `http://127.0.0.1:${(server.address() as any).port}/v1`,
    model: 'test',
    key: '',
  };
  try {
    assert.equal((await extractConnection(provider, 'a test description')).fields.port, 2222);
    assert.equal(requests[0].tools, undefined);
    assert.equal(requests[0].messages[1].content, 'a test description');
    output = { providerId: 'cshell.ssh', fields: { host: 'example.test', command: 'whoami' } };
    await assert.rejects(extractConnection(provider, 'test'), /有效/);
    output = { providerId: 'cshell.ssh', fields: { host: 'bad host', port: 99999 } };
    await assert.rejects(extractConnection(provider, 'test'));
    output = { providerId: 'docker', fields: { host: 'example.test' } };
    await assert.rejects(extractConnection(provider, 'test'));
    output = {};
    await assert.rejects(extractConnection(provider, 'test'));
    tool = true;
    await assert.rejects(extractConnection(provider, 'test'), /Invalid/);
    tool = false;
    status = 401;
    await assert.rejects(extractConnection(provider, 'test'), /401/);
    await assert.rejects(extractConnection(provider, 'x'.repeat(24001)));
    status = 200;
    output = 'x'.repeat(100001);
    await assert.rejects(extractConnection(provider, 'test'), /too large/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
