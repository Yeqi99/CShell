import test from 'node:test';
import assert from 'node:assert/strict';
import {editorFileFromCommand, textCandidate} from '../src/ui/text-path';
test('editor file hints never resolve relative paths or shell expansions by guessing', () => {
  assert.equal(editorFileFromCommand('vim "/etc/my config"'), '/etc/my config');
  assert.equal(editorFileFromCommand('nano /etc/config'), '/etc/config');
  for (const command of ['vim config', 'vim $HOME/a', 'vim /a /b', 'vim /a; rm /b', 'vim "$(pwd)/a"', 'vim -R /a'])
    assert.equal(editorFileFromCommand(command), null);
});
test('text candidates include unknown extensions and extensionless files for content inspection', () => {
  assert.equal(textCandidate('/project/README'), true);
  assert.equal(textCandidate('/project/settings.custom'), true);
  assert.equal(textCandidate('/project/archive.zip'), false);
});
