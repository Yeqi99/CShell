import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEditor, editorFromCommand } from '../src/ui/editor-detection';
import { editorActionInput, editorPromptBusy } from '../src/ui/editor-actions';
test('editor detection ignores scrollback-like normal output and unrelated full-screen apps', () => {
  const vim = ['file contents', '~', '~', '1,1 All'];
  assert.equal(detectEditor(vim, false), null);
  assert.equal(detectEditor(['vim README.md', 'nano instructions', '$ '], true), null);
  assert.equal(detectEditor(['htop', 'CPU 10%', '1 bash'], true), null);
  assert.equal(detectEditor(vim, true)?.kind, 'vim');
  assert.equal(detectEditor(['file', '~', '~', '-- 插入 --'], true)?.kind, 'vim');
});
test('editor detection distinguishes Nano default and modern key bindings', () => {
  assert.deepEqual(
    detectEditor(['GNU nano 7.2   file', '', '^G Help ^O Write Out ^W Where Is', '^X Exit'], true),
    { kind: 'nano', nanoModern: false, nanoSearch: 'Ctrl+W' },
  );
  assert.deepEqual(
    detectEditor(['GNU nano 8.0   file', '', '^F Search ^C Copy', '^Q Exit ^X Cut'], true),
    { kind: 'nano', nanoModern: true, nanoSearch: 'Ctrl+F' },
  );
  assert.equal(editorActionInput('nano', 'exit', '', true), '\x11');
  assert.equal(editorActionInput('nano', 'exit'), '\x18');
});
test('launch hints match editor commands, not prose or pipelines', () => {
  for (const value of ['vim file', 'sudo -u root /usr/bin/vim file', 'nvim', 'vi file'])
    assert.equal(editorFromCommand(value), 'vim');
  assert.equal(editorFromCommand('nano file'), 'nano');
  for (const value of [
    'echo vim',
    'cat vim',
    'vim --version | cat',
    'vim file; less other',
    'vimx file',
  ])
    assert.equal(editorFromCommand(value), null);
});

test('editor actions normalize Vim mode, quote literal queries and reject control input', () => {
  assert.equal(editorActionInput('vim', 'normal'), '\x1c\x0e');
  assert.equal(editorActionInput('vim', 'insert'), '\x1c\x0ei');
  assert.equal(editorActionInput('vim', 'visualBlock'), '\x1c\x0e\x16');
  assert.equal(editorActionInput('vim', 'exitAll'), '\x1c\x0e:qall\r');
  assert.equal(editorActionInput('vim', 'discard'), '\x1c\x0e:qall!\r');
  assert.equal(editorActionInput('nano', 'cancel'), '\x03');
  assert.equal(editorActionInput('vim', 'first'), '\x1c\x0e:normal! gg\r');
  assert.equal(editorActionInput('vim', 'last'), '\x1c\x0e:normal! G\r');
  assert.equal(editorActionInput('vim', 'line', '42'), '\x1c\x0e:42\r');
  for (const value of ['0', '-1', '42|q!', '1\r!echo bad'])
    assert.throws(() => editorActionInput('vim', 'line', value));
  for (const value of ['', 'a\nb', 'a\x1bb'])
    assert.throws(() => editorActionInput('vim', 'search', value));
  const query = editorActionInput('vim', 'search', "a'|q! /路径");
  assert.ok(query.includes("a''|q! /路径'\r:call search(@/, 'w')\r"));
  assert.equal(query.split('\r').length, 3);
  assert.equal(editorActionInput('nano', 'search'), '\x17');
  assert.equal(editorActionInput('nano', 'save'), '\x0f');
  assert.throws(() => editorActionInput('nano', 'saveExit'));
  assert.equal(editorPromptBusy(['GNU nano 7.2', 'Search:', '^C Cancel'], 'nano'), true);
  assert.equal(editorPromptBusy(['Press ENTER or type command to continue'], 'vim'), true);
});
