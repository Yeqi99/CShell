import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersion, selectRelease, checksumFor } from '../src/shared/updates';
const release = (version: string, suffix = 'win-x64.exe') => ({
  tag_name: 'v' + version,
  draft: false,
  prerelease: true,
  assets: [
    { name: 'CShell-' + version + '-' + suffix, size: 10 },
    { name: 'SHA256SUMS.txt', size: 80 },
  ].map((a) => ({
    ...a,
    browser_download_url:
      'https://github.com/Yeqi99/CShell/releases/download/v' + version + '/' + a.name,
  })),
});

test('Pro and base applications select only their own release assets', () => {
  const base = release('0.8.2');
  const pro = JSON.parse(JSON.stringify(base).replaceAll('CShell-0.8.2', 'CShell-Pro-0.8.2'));
  assert.equal(selectRelease([base], 'win32', 'x64', true), undefined);
  assert.equal(selectRelease([pro], 'win32', 'x64'), undefined);
  assert.equal(selectRelease([pro], 'win32', 'x64', true)?.asset.name, 'CShell-Pro-0.8.2-win-x64.exe');
});
test('updates compare numeric versions and select complete platform releases including previews', () => {
  assert.equal(compareVersion('0.3.10', '0.3.9'), 1);
  assert.equal(
    selectRelease([release('0.3.2'), release('0.3.10')], 'win32', 'x64')?.version,
    '0.3.10',
  );
  assert.equal(
    selectRelease([release('0.4.0', 'mac-arm64.dmg')], 'darwin', 'arm64')?.version,
    '0.4.0',
  );
  assert.equal(
    selectRelease([release('0.4.0', 'linux-x86_64.AppImage')], 'linux', 'x64')?.version,
    '0.4.0',
  );
  assert.equal(
    selectRelease([{ ...release('0.4.0'), draft: true }, release('0.3.2')], 'win32', 'x64')
      ?.version,
    '0.3.2',
  );
  assert.equal(selectRelease([release('0.4.0', 'mac-arm64.dmg')], 'win32', 'x64'), undefined);
});
test('updates reject substituted URLs and ambiguous checksums', () => {
  const r = release('0.3.2');
  r.assets[0].browser_download_url = 'https://evil.example/setup.exe';
  assert.throws(() => selectRelease([r], 'win32', 'x64'));
  const sum = 'a'.repeat(64);
  assert.equal(checksumFor(sum + '  app.exe', 'app.exe'), sum);
  assert.throws(() => checksumFor(sum + '  app.exe\n' + sum + '  app.exe', 'app.exe'));
  assert.throws(() => checksumFor(sum + '  other.exe', 'app.exe'));
});
