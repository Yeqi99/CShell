import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConsoleCommand, commandLabel } from '../src/shared/command-console';
import { localApiTransport, runConsoleCommand } from '../src/core/command-client';
import { runCli } from '../src/cli/main';
import { McpService } from '../src/core/mcp';
import { Store } from '../src/core/store';

test('command language preserves JSON but cannot evaluate shell substitutions, pipes or command chains', () => {
  for (const text of ['whoami; calc', 'powershell -Command whoami', 'echo x | sh', 'call read_file []', 'call read_file null', 'use ../../etc']) assert.throws(() => parseConsoleCommand(text));
  const parsed = parseConsoleCommand('call http_request {"body":"$(whoami); & rm -rf /"}');
  assert.equal(parsed.type, 'invoke');
  if (parsed.type === 'invoke') assert.deepEqual(parsed.arguments, { body: '$(whoami); & rm -rf /' });
  assert.equal(commandLabel('call login {"password":"private-secret"}'), 'login');
  assert.equal(commandLabel('bad private-secret'), '命令');
  assert.equal(parseConsoleCommand('cshell help').type, 'help');
});

test('context, exact guide and paginated catalog share the same transport without replay', async () => {
  const calls: any[] = [], id = randomUUID(); let page = 0;
  const transport = async (path: string, body: any) => { calls.push({ path, body }); return path === 'capabilities' ? { items: [{ id: `tool.${++page}`, name: 'read' }], nextCursor: page === 1 ? 'second' : undefined } : { ok: true }; };
  const catalog = await runConsoleCommand('tools browser', transport, id);
  assert.equal((catalog.value as any[]).length, 2); assert.equal(calls[1].body.cursor, 'second'); assert.equal(calls[1].body.sessionId, id);
  await runConsoleCommand('call files_list {"path":"/"}', transport, id);
  assert.deepEqual(calls[2].body, { name: 'invoke_connection', arguments: { sessionId: id, tool: 'files_list', arguments: { path: '/' } } });
  await runConsoleCommand('api list_servers', transport, id); assert.equal(calls[3].body.name, 'list_servers');
  const before = calls.length; await runConsoleCommand(`use ${id}`, transport); assert.equal(calls.length, before);
  let attempts = 0; await assert.rejects(runConsoleCommand('call mutate {}', async () => { attempts++; throw Error('disconnected'); }), /disconnected/); assert.equal(attempts, 1);
});

test('CLI endpoint refuses remote hosts, credentials and URL tricks', () => {
  for (const url of ['https://127.0.0.1:3777', 'http://127.0.0.1.example', 'http://127.0.0.1@evil.test', 'http://localhost/a', 'http://localhost/?token=x', 'http://localhost/#x']) assert.throws(() => localApiTransport(url, 'secret'));
  assert.throws(() => localApiTransport('http://127.0.0.1', 'bad\r\nvalue'));
});

test('CLI SIGINT cancels a still-open stdin pipe without waiting for EOF or invoking API', async () => {
  const entry=pathToFileURL(resolve('src/cli/main.ts')).href;
  const script=`import {runCli} from ${JSON.stringify(entry)};
    process.on('message',()=>process.emit('SIGINT'));
    const result=runCli(['--stdin','call','never_execute']);
    process.send('reading');
    process.exitCode=await result;
    process.disconnect();`;
  const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{stdio:['pipe','pipe','pipe','ipc'],windowsHide:true});
  let stdout='',stderr='';child.stdout!.on('data',value=>stdout+=value);child.stderr!.on('data',value=>stderr+=value);
  const exited=new Promise<number|null>((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
  const timeout=setTimeout(()=>child.kill(),15000);
  try {
    await new Promise<void>((resolve,reject)=>{child.once('message',()=>resolve());child.once('error',reject);child.once('exit',()=>reject(Error('CLI exited before reading stdin')));});
    child.stdin!.write('{"password":"private-incomplete');
    child.send('cancel');
    assert.equal(await exited,130);
    assert.equal(stdout,'');
    assert.match(stderr,/aborted|Abort/i);
    assert.doesNotMatch(stderr,/private-incomplete|API 访问|令牌/);
  } finally {clearTimeout(timeout);child.stdin!.destroy();if(child.exitCode===null)child.kill();}
});

test('real local API catalog and CLI respect scoped visibility, token validation and output files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-command-test-'));
  const store = new Store(directory, { encrypt: async s => Buffer.from(s).toString('base64'), decrypt: async s => Buffer.from(s, 'base64').toString() });
  await store.load();
  const id = randomUUID(), hidden = randomUUID();
  for (const profileId of [id, hidden]) await store.saveProfile({ id: profileId, name: profileId === id ? 'Visible' : 'Hidden', host: '192.0.2.1', port: 22, username: 'test', group: '', favorite: false, auth: 'password' });
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = (probe.address() as {port:number}).port; await new Promise<void>(resolve => probe.close(() => resolve()));
  const service = new McpService(store, directory, async () => false);
  const output: string[] = [], errors: string[] = [];
  try {
    await service.configure({ enabled: true, port, allowedProfiles: [id], allowCommands: false });
    const token = await service.accessToken(), endpoint = `http://127.0.0.1:${port}`;
    const transport = localApiTransport(endpoint, token);
    const catalog = await runConsoleCommand('tools', transport); assert.equal(catalog.kind, 'catalog'); assert((catalog.value as any[]).some(t => t.name === 'list_servers'));
    const servers = await runConsoleCommand('servers', transport); assert.match(JSON.stringify(servers), /Visible/); assert.doesNotMatch(JSON.stringify(servers), /Hidden/);
    await assert.rejects(runConsoleCommand(`connect ${hidden}`, transport), /NOT_FOUND|FORBIDDEN/);
    await assert.rejects(runConsoleCommand('servers', localApiTransport(endpoint, 'invalid-token')), /令牌失效/);
    const tokenFile = join(directory, 'token'), destination = join(directory, 'result.json'); await writeFile(tokenFile, token);
    const options = ['--endpoint', endpoint, '--token-file', tokenFile, '--out', destination, 'servers'];
    const out = { write: (text: string) => { output.push(text); return true; } } as typeof process.stdout;
    const err = { write: (text: string) => { errors.push(text); return true; } } as typeof process.stderr;
    assert.equal(await runCli(options, out, err), 0); assert.match(await readFile(destination, 'utf8'), /Visible/);
    assert.equal(await runCli(options, out, err), 1, 'output never overwrites an existing file');
    assert(![...output, ...errors].join('').includes(token));
    const status = service.status(); assert.equal(status.settings.allowCommands, false); assert.deepEqual(status.settings.allowedProfiles, [id]);
  } finally { await service.stop(); await rm(directory, { recursive: true, force: true }); }
});
