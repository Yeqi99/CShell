import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeComposerAttachments, validateComposerFiles } from '../src/ui/composer-attachments';

test('UTF-8 source and pasted PNG survive serialization including base64 chunk boundaries', async () => {
  const source = '中文 '.repeat(12345);
  const [code, png] = await encodeComposerAttachments([
    new File([source], 'example.ts'), new File([Uint8Array.of(137,80,78,71,13,10,26,10)], 'clipboard.png'),
  ]);
  assert.equal(Buffer.from(code.data, 'base64').toString(), source);
  assert.equal(code.mime, 'text/plain');
  assert.equal(png.mime, 'image/png');
});

test('size/count checks precede reading and unsupported files are explicit', async () => {
  const file = new File(['x'], 'data.csv');
  assert.throws(() => validateComposerFiles(Array(7).fill(file)), /6/);
  assert.throws(() => validateComposerFiles([new File([new Uint8Array(8*1024*1024+1)], 'large.txt')]), /8 MiB/);
  assert.throws(() => validateComposerFiles([new File(['doc'], 'file.pdf')]), /格式/);
  await assert.rejects(encodeComposerAttachments([new File(['document'], 'file.jpg')]), /图片格式/);
  await assert.rejects(encodeComposerAttachments([new File([Uint8Array.of(255)], 'data.csv')]), /UTF-8/);
});
