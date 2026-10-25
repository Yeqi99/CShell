import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { AiService } from '../src/core/ai';
import { Store } from '../src/core/store';
import { ConnectionRegistry } from '../src/core/connections/registry';
import { encodeRequest } from '../src/extensions/opencode/protocol';
import { visualAuditJson } from '../src/core/visual-privacy';

test('screenshots remain encrypted, bypass text truncation, reach image protocols, and unsupported requests are never retried', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-vision-')),
    key = randomBytes(32);
  const codec = {
    encrypt: async (text: string) => {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]).toString(
        'base64',
      );
    },
    decrypt: async (text: string) => {
      const b = Buffer.from(text, 'base64'),
        cipher = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
      cipher.setAuthTag(b.subarray(-16));
      return Buffer.concat([cipher.update(b.subarray(12, -16)), cipher.final()]).toString();
    },
  };
  const store = new Store(directory, codec),
    profileId = randomUUID(),
    sessionId = randomUUID();
  const image = {
    mimeType: 'image/jpeg' as const,
    dataBase64: Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(22000, 23)]).toString(
      'base64',
    ),
    width: 640,
    height: 480,
    target: 'fixture',
    frameId: 'actual-frame',
  };
  const registry = new ConnectionRegistry(() => ({ id: profileId, group: '' }));
  const connection = {
    target: {
      providerId: 'fixture.machine',
      resourceId: profileId,
      identity: 'identity',
      label: 'fixture',
    },
    tools: [
      {
        name: 'browser_screenshot',
        capability: 'browser.read',
        input: z.object({}).strict(),
        description: 'fixture screenshot',
        needsReview: () => false,
        invoke: async () => JSON.stringify(image),
      },
    ],
  };
  registry.register({
    id: 'fixture.machine',
    version: '1.0.0',
    capabilities: ['browser.read'],
    resolve: () => connection,
  });
  registry.bind(sessionId, 'fixture.machine');
  const ai = new AiService(directory, store, registry);
  const requests: any[] = [];
  let reject = false,
    requestCapture = true,
    imageInput: boolean | undefined;
  const provider = {
    id: randomUUID(),
    name: 'image fixture',
    url: 'https://example.invalid',
    model: 'fixture',
    extension: { id: 'fixture.models', model: 'fixture' },
  };
  ai.providerExtensions.register({
    id: 'fixture.models',
    call: async () => null,
    resolve: async () => ({
      url: 'https://example.invalid',
      model: 'fixture',
      key: '',
      imageInput,
      transport: async (_url, init) => {
        const b = JSON.parse(String(init?.body));
        requests.push(b);
        if (reject && JSON.stringify(b.messages).includes('image_url'))
          return new Response('unsupported image', { status: 400 });
        const message =
          requestCapture && !b.messages.some((m: any) => Array.isArray(m.content))
            ? {
                tool_calls: [
                  {
                    id: 'image-call',
                    type: 'function',
                    function: { name: 'browser_screenshot', arguments: '{}' },
                  },
                ],
              }
            : { content: '截图已读取' };
        return Response.json({ choices: [{ message }] });
      },
    }),
  });
  const settled = async (id: string) => {
    for (let i = 0; i < 300; i++) {
      const t = ai.snapshot().threads.find((t) => t.id === id)!;
      if (!['running', 'approval'].includes(t.state)) return t;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error('AI did not settle');
  };
  try {
    await store.load();
    await ai.load();
    await ai.saveProvider(provider);
    await ai.savePolicy({
      ...ai.snapshot().policy,
      profiles: [profileId],
      capabilities: ['browser.read'],
    });
    const thread = await ai.create('workspace', provider.id, 'allow', sessionId);
    await ai.send(thread.id, '查看页面截图');
    const first = await settled(thread.id);
    assert.equal(first.state, 'idle');
    assert.equal(requests.length, 2);
    const wire = requests[1],
      part = wire.messages.at(-1).content[1];
    assert.equal(part.image_url.url, 'data:image/jpeg;base64,' + image.dataBase64);
    assert.ok(!JSON.stringify(first).includes(image.dataBase64));
    assert.ok(first.messages.some((m) => m.tool?.image));
    assert.ok(!first.messages.some((m) => m.content.includes('完整日志')));
    const files = await readdir(join(directory, 'ai-images'));
    assert.equal(files.length, 1);
    assert.ok(
      !(await readFile(join(directory, 'ai-images', files[0]), 'utf8')).includes(image.dataBase64),
    );
    for (const family of ['responses', 'anthropic', 'google'] as const) {
      const adapted = encodeRequest(family, wire),
        data = JSON.stringify(adapted);
      assert.ok(data.includes(image.dataBase64));
      assert.ok(
        data.includes(
          family === 'responses'
            ? 'input_image'
            : family === 'anthropic'
              ? 'media_type'
              : 'inlineData',
        ),
      );
    }
    assert.throws(
      () =>
        encodeRequest('anthropic', {
          messages: [
            {
              role: 'user',
              content: [{ type: 'image_url', image_url: { url: 'https://private.example/pixel' } }],
            },
          ],
        }),
      /本地图像/,
    );
    requestCapture = false;
    reject = true;
    await ai.send(thread.id, '继续查看上一张图片');
    const failed = await settled(thread.id);
    assert.equal(failed.state, 'error');
    assert.match(failed.error!, /未接受图片输入/);
    assert.equal(requests.length, 3);
    assert.ok(failed.messages.find((m) => m.tool?.image)?.tool?.imageRejected);
    await ai.send(thread.id, '改用文字');
    assert.equal((await settled(thread.id)).state, 'idle');
    assert.ok(!JSON.stringify(requests.at(-1)).includes('image_url'));
    assert.equal(requests.length, 4);
    imageInput = false;
    const textOnly = await ai.create('workspace', provider.id, 'allow', sessionId);
    await ai.send(textOnly.id, '列出能做的事');
    await settled(textOnly.id);
    assert.ok(!requests.at(-1).tools?.some((t: any) => t.function.name === 'browser_screenshot'));
  } finally {
    ai.dispose();
    await ai.flush();
    await rm(directory, { recursive: true, force: true });
  }
});

test('browser text/select and desktop text are redacted even when fields are not named password', () => {
  for (const name of ['browser_interact', 'desktop_interact']) {
    const raw = JSON.stringify({
      action: name === 'browser_interact' ? 'fill' : 'text',
      text: 'private-otp-value',
    });
    assert.ok(!visualAuditJson(name, raw).includes('private-otp-value'));
  }
  assert.ok(
    !visualAuditJson(
      'browser_interact',
      JSON.stringify({ action: 'select', value: 'private-value' }),
    ).includes('private-value'),
  );
  assert.ok(
    !visualAuditJson(
      'invoke_connection',
      JSON.stringify({
        tool: 'browser_interact',
        arguments: { action: 'fill', text: 'private-otp-value' },
      }),
    ).includes('private-otp-value'),
  );
});
