import { test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { protectPath } from '../src/agent/storage';

test(
  'Windows Agent ACLs remain owner-only and failures are bounded and redacted',
  { skip: process.platform !== 'win32', timeout: 60000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'cshell-private-acl-'));
    const file = join(directory, "private 中文 ' $value.txt");
    try {
      await protectPath(directory, true);
      await writeFile(file, 'fixture');
      await protectPath(file);
      const script =
        "$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);$paths=ConvertFrom-Json ([Console]::In.ReadToEnd());$self=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;@($paths | ForEach-Object {$a=if([IO.Directory]::Exists($_)){[IO.Directory]::GetAccessControl($_)}else{[IO.File]::GetAccessControl($_)};@{protected=$a.AreAccessRulesProtected;ownerSelf=($a.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $self);rules=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object {@{self=($_.IdentityReference.Value -eq $self);allow=($_.AccessControlType -eq 'Allow');inherited=$_.IsInherited;rights=[string]$_.FileSystemRights;inheritance=[string]$_.InheritanceFlags}})}}) | ConvertTo-Json -Depth 5 -Compress";
      const output = await new Promise<string>((resolve, reject) => {
        const process = childProcess.execFile(
          join(
            globalThis.process.env.SystemRoot || 'C:\\Windows',
            'System32/WindowsPowerShell/v1.0/powershell.exe',
          ),
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
          { windowsHide: true, timeout: 15000 },
          (error, stdout) => (error ? reject(error) : resolve(stdout)),
        );
        process.stdin!.end(JSON.stringify([directory, file]));
      });
      const permissions = JSON.parse(output);
      assert.equal(permissions.length, 2);
      for (const acl of permissions) {
        assert.equal(acl.protected, true);
        assert.equal(acl.ownerSelf, true);
        assert.equal(acl.rules.length, 1);
        assert.deepEqual(
          { ...acl.rules[0], inheritance: undefined },
          {
            self: true,
            allow: true,
            inherited: false,
            rights: 'FullControl',
            inheritance: undefined,
          },
        );
      }
      assert.match(permissions[0].rules[0].inheritance, /ContainerInherit/);
      assert.match(permissions[0].rules[0].inheritance, /ObjectInherit/);
      assert.equal(permissions[1].rules[0].inheritance, 'None');

      await t.test('a real ACL failure rejects without exposing the target', async () => {
        const missing = join(directory, 'private-missing-target');
        await assert.rejects(protectPath(missing), (error: Error) => {
          assert.match(error.message, /stage=acl-apply, kind=exit/);
          assert.match(error.message, /code=1/);
          assert.ok(!error.message.includes(directory));
          assert.ok(!error.message.includes('private-missing-target'));
          return true;
        });
      });

      for (const stdout of ['', 'CSHELL_ACL_START\r\n']) {
        await t.test(
          `timeout before ${stdout ? 'ACL completion' : 'PowerShell startup'}`,
          async (t) => {
            let killed = false;
            t.mock.method(childProcess, 'execFile', (...args: any[]) => {
              const callback = args.at(-1);
              return {
                stdin: new PassThrough(),
                kill() {
                  killed = true;
                  callback(
                    Object.assign(new Error(`secret ${file}`), { code: null, signal: 'SIGTERM' }),
                    stdout,
                    file,
                  );
                  return true;
                },
              };
            });
            syncBuiltinESMExports();
            t.after(() => {
              t.mock.restoreAll();
              syncBuiltinESMExports();
            });
            t.mock.timers.enable({ apis: ['setTimeout'] });
            const result = protectPath(file);
            const rejected = assert.rejects(result, (error: Error) => {
              assert.match(error.message, /kind=timeout/);
              assert.match(error.message, stdout ? /stage=acl-apply/ : /stage=powershell-start/);
              assert.ok(!error.message.includes(file));
              assert.ok(!error.message.includes('secret'));
              return true;
            });
            t.mock.timers.tick(15000);
            await rejected;
            assert.equal(killed, true);
          },
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
