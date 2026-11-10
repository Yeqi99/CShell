import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Run against a designated test machine. Opens and closes its Run dialog.
const [endpoint, profileId, mode] = process.argv.slice(2);
const token = process.env.CSHELL_TEST_MCP_TOKEN;
if (!token || !profileId || !['view', 'control'].includes(mode))
  throw Error('Supply MCP URL, saved RDP profile ID, view/control, and CSHELL_TEST_MCP_TOKEN.');
const url = new URL(endpoint);
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw Error('Use local CShell MCP.');
const client = new Client({ name: 'CShell RDP acceptance', version: '1' });
await client.connect(
  new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: 'Bearer ' + token } },
  }),
);
const call = (name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args });
const parse = (reply: Awaited<ReturnType<typeof call>>) => {
  assert(
    !reply.isError && Array.isArray(reply.content) && reply.content[0]?.type === 'text',
    'MCP request failed',
  );
  return JSON.parse(reply.content[0].text);
};
let sessionId: string | undefined;
try {
  assert(
    (await client.listTools()).tools.some((tool) => tool.name === 'invoke_connection'),
    'Use a full-disclosure test client',
  );
  sessionId = parse(await call('connect', { profileId })).sessionId;
  const description = parse(await call('describe_connection', { sessionId }));
  assert.equal(description.target.providerId, 'cshell.rdp');
  assert.equal(description.target.resourceId, profileId);
  const names = description.tools.map((tool: { name: string }) => tool.name);
  assert(names.includes('desktop_screenshot'));
  assert.equal(names.includes('desktop_interact'), mode === 'control');
  const invoke = (tool: string, args: Record<string, unknown>) =>
    call('invoke_connection', { sessionId, tool, arguments: args });
  const capture = async () => {
    const reply = await invoke('desktop_screenshot', { maxWidth: 480 });
    assert(!reply.isError && Array.isArray(reply.content));
    const image = reply.content.find((part) => part.type === 'image');
    assert(image?.type === 'image' && image.mimeType === 'image/jpeg' && image.data.length > 100);
    return image.data;
  };
  await delay(4000);
  const before = await capture();
  const key = (scanCode: number, modifiers: string[] = []) =>
    invoke('desktop_interact', { action: 'key', scanCode, modifiers });
  const response = await key(19, ['win']);
  if (mode === 'view') assert.equal(response.isError, true);
  else {
    assert(!response.isError);
    let opened: string;
    try {
      await delay(1200);
      opened = await capture();
      assert(opened !== before, 'Run dialog did not change the frame');
    } finally {
      assert(!(await key(1)).isError, 'Escape failed');
    }
    await delay(800);
    assert((await capture()) !== opened, 'Dialog did not close');
  }
  console.log('Passed:', mode, names.join(', '));
} finally {
  try {
    if (sessionId) await call('disconnect', { sessionId });
  } finally {
    await client.close();
  }
}
