import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WslSetup, wslSetupScript, wslFailureMessage } from '../src/desktop/wsl-setup';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('offline import rejects invalid names and nonempty targets before launching WSL',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'wsl-import-test-'));
  try{
    const image=join(dir,'rootfs.tar');await writeFile(image,'not a real image');
    const setup=new WslSetup();
    assert.throws(()=>setup.importImage('--bad',image,dir),/名称/);
    assert.equal(setup.importImage('Test',image,dir).phase,'running');
    assert.throws(()=>setup.importImage('Other',image,dir),/等待/);
    const until=Date.now()+2000;while(setup.snapshot().phase==='running'&&Date.now()<until)await new Promise(r=>setTimeout(r,10));
    assert.equal(setup.snapshot().phase,'error');assert.match(setup.snapshot().message!,/必须为空/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('WSL progress remains live and quiet installs explain a stall without allowing duplicate installation', async (t) => {
  let now=1000;
  t.mock.method(Date,'now',()=>now);
  let notify!: (message:string,details?:string)=>void;
  let finish!: (code:number)=>void;
  let calls=0;
  const setup=new WslSetup((_ubuntu,progress)=>{calls++;notify=progress;return new Promise(r=>finish=r);});
  setup.start(true);
  notify('正在下载 Ubuntu：12.0 MiB','Downloading 12%');
  assert.match(setup.snapshot().message!,/12.0 MiB/);
  now+=91000;
  assert.equal(setup.snapshot().phase,'running');
  assert.match(setup.snapshot().message!,/90 秒/);
  setup.start(true);assert.equal(calls,1);
  notify('正在注册发行版');
  assert.equal(setup.snapshot().message,'正在注册发行版');
  assert.equal(setup.snapshot().details,'Downloading 12%');
  finish(0);await new Promise(r=>setImmediate(r));
  assert.equal(setup.snapshot().phase,'complete');
});

test('WSL network failures explain recovery without claiming the runtime is missing', () => {
  assert.match(
    wslFailureMessage(-1, 'Wsl/InstallDistro/WININET_E_CANNOT_CONNECT'),
    /系统代理与网络/,
  );
  assert.match(wslFailureMessage(-1, 'WININET_E_NAME_NOT_RESOLVED'), /下载服务/);
  assert.match(wslFailureMessage(5, 'Access denied'), /退出码 5/);
});
test('WSL setup uses fixed elevated commands and keeps installation lifecycle', async () => {
  assert.match(wslSetupScript(true), /Ubuntu/);
  assert.match(wslSetupScript(false), /--no-distribution/);
  assert.match(wslSetupScript(true), /-Verb RunAs/);
  assert.doesNotMatch(wslSetupScript(true), /Restart-Computer/);
  let resolve!: (code: number) => void;
  let count = 0;
  const setup = new WslSetup(() => {
    count++;
    return new Promise((r) => {
      resolve = r;
    });
  });
  assert.equal(setup.start(true).phase, 'running');
  setup.start(false);
  assert.equal(count, 1);
  resolve(3010);
  await new Promise((r) => setImmediate(r));
  assert.equal(setup.snapshot().phase, 'complete');
  assert.match(setup.snapshot().message!, /重启/);
  const denied = new WslSetup(async () => {
    throw new Error('UAC canceled');
  });
  denied.start(true);
  await new Promise((r) => setImmediate(r));
  assert.equal(denied.snapshot().phase, 'error');
  const failed = new WslSetup(async () => 5);
  failed.start(false);
  await new Promise((r) => setImmediate(r));
  assert.equal(failed.snapshot().phase, 'error');
});
import { decodeWslOutput, wslInstallArguments } from '../src/desktop/wsl-setup';
test('WSL bootstrap uses only supported flags and decodes native diagnostics', () => {
  assert.ok(wslInstallArguments('--install --no-launch --web-download', true).includes('--web-download'));
  assert.ok(!wslInstallArguments('--install --no-launch --web-download', false).includes('--web-download'));
  assert.deepEqual(wslInstallArguments('--install --update --help', true), ['--install']);
  assert.throws(() => wslInstallArguments('--install --update --help', false), /引导程序/);
  assert.deepEqual(wslInstallArguments('--install --no-launch', true), [
    '--install',
    '--distribution',
    'Ubuntu',
    '--no-launch',
  ]);
  assert.equal(decodeWslOutput(Buffer.from('需要重启\r\r\n', 'utf16le')), '需要重启');
});
