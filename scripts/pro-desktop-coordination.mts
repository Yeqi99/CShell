import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
import { fixture } from '../tests/fixture';

const data = await mkdtemp(join(tmpdir(), 'cshell-coordination-')),
  ssh = await fixture();
const bytes = randomBytes(500000),
  digest = createHash('sha256').update(bytes).digest('hex');
const source = join(data, '源.bin'),
  copy = join(data, '副本.bin');
await writeFile(source, bytes);
const inputText = '桌面验收中文';
const formTitle = 'CShell acceptance ' + randomUUID();
const formScript = `Add-Type -AssemblyName System.Windows.Forms
$f=New-Object Windows.Forms.Form;$f.Text='${formTitle}';$f.StartPosition='CenterScreen';$f.TopMost=$true
$t=New-Object Windows.Forms.TextBox;$t.Multiline=$true;$t.Dock='Fill';$f.Controls.Add($t)
$t.Add_TextChanged({$f.Text=$t.Text})
$t.Add_MouseDoubleClick({$f.Text='dbl'})
$t.Add_MouseDown({param($sender,$eventArgs) if($eventArgs.Button -eq [Windows.Forms.MouseButtons]::Right){$f.Text='right'}})
$t.Add_MouseWheel({$f.Text='wheel'})
$t.Add_MouseMove({if($_.Button -eq [Windows.Forms.MouseButtons]::Left){$f.Text='drag'}})
$f.Add_Shown({$t.Focus()});[void]$f.ShowDialog()`;
const launchForm = () =>
  spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-STA',
      '-EncodedCommand',
      Buffer.from(formScript, 'utf16le').toString('base64'),
    ],
    { windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] },
  );
let form: ReturnType<typeof launchForm>;
let handle = '',
  index = 0,
  failure: unknown;
const actions: any[] = [];
const server = createServer(async (req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
    res.end(
      '<title>浏览器验收</title><script>console.error("test-console-marker")</script><label>姓名<input id="name"></label><button id="ok" onclick="document.title=document.querySelector(\'#name\').value">提交</button>',
    );
    return;
  }
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString()),
      last = body.messages.filter((m) => m.role === 'tool').at(-1);
    if (index) {
      const previous = actions[index - 1];
      if (previous.expectError) {
        assert.match(last.content, previous.expectError);
      } else {
        assert.ok(last && !last.content.startsWith('Error:'), last?.content);
        previous.check?.(JSON.parse(last.content), body);
      }
    }
    const step = actions[index++];
    if (step) console.log('Testing', step.name, step.args.operation?.action ?? '');
    if (step)
      assert.ok(
        body.tools.some((t) => t.function.name === step.name),
        step.name,
      );
    const msg = step
      ? {
          content: null,
          tool_calls: [
            {
              id: randomUUID(),
              type: 'function',
              function: {
                name: step.name,
                arguments: JSON.stringify(
                  typeof step.args === 'function' ? step.args() : step.args,
                ),
              },
            },
          ],
        }
      : { content: '验收完成' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: msg }] }));
  } catch (e) {
    failure = e;
    res.writeHead(500);
    res.end('验收失败');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = 'http://127.0.0.1:' + server.address().port;
const add = (name, args, check?) => actions.push({ name: 'local_desktop_' + name, args, check });
const browser = (op, check?, screenshot = false) =>
  add('browser', { operation: op, screenshot }, check);
const hasImage = (b) =>
  b.messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((c) => c.image_url?.url.startsWith('data:image/jpeg;base64,')),
  );
add('upload', { remotePath: '/数据.bin', localPath: source }, (s) =>
  assert.equal(s.sha256, digest),
);
add('download', { remotePath: '/数据.bin', localPath: copy }, (s) =>
  assert.equal(s.sha256, digest),
);
actions.push({
  name: 'local_desktop_upload',
  args: { remotePath: '/数据.bin', localPath: source },
  expectError: /已存在/,
});
actions.push({
  name: 'local_desktop_download',
  args: { remotePath: '/数据.bin', localPath: copy },
  expectError: /EEXIST/,
});
add('interact', { operation: { action: 'windows' } }, (s) => {
  handle = s.windows.find((w) => w.MainWindowTitle === formTitle)?.handle;
  assert.ok(handle);
});
add('interact', () => ({ operation: JSON.stringify({ action: 'controls', handle }) }), (state) => {
  assert.equal(state.targetHandle, handle);
  assert.ok(state.controls.some(c => /edit/i.test(c.role + c.class) && c.x > 0 && c.y > 0));
});
add('click', { x: 0.5, y: 0.5, screenshot: true }, (s, b) => {
  assert.equal(s.handle, handle);
  assert.ok(hasImage(b));
});
add(
  'interact',
  () => ({ operation: { action: 'focus', handle } }),
  (s) => assert.equal(s.handle, handle),
);
add('interact', { operation: { action: 'inspect' } }, (s) => {
  assert.equal(s.handle, handle);
  assert.ok(s.focusedControl.type.startsWith('ControlType.'));
});
add('interact', { operation: { action: 'type', text: inputText }, screenshot: true }, (s, b) => {
  assert.equal(s.windowTitle, inputText);
  assert.ok(hasImage(b));
});
add('interact', { operation: { action: 'keys', keys: '{HOME}+{END}{BACKSPACE}' } }, (s) =>
  assert.equal(s.windowTitle, ''),
);
add('interact', { operation: { action: 'doubleClick', x: 0.5, y: 0.5 } }, (s) =>
  assert.equal(s.windowTitle, 'dbl'),
);
add('interact', { operation: { action: 'scroll', x: 0.5, y: 0.5, ticks: -1 } }, (s) =>
  assert.equal(s.windowTitle, 'wheel'),
);
add('interact', { operation: { action: 'drag', x: 0.5, y: 0.5, toX: 0.515, toY: 0.515 } }, (s) =>
  assert.equal(s.windowTitle, 'drag'),
);
add('interact', { operation: { action: 'rightClick', x: 0.5, y: 0.5 } }, (s) =>
  assert.equal(s.windowTitle, 'right'),
);
add('interact', { operation: { action: 'keys', keys: '{ESC}' } });
add(
  'command',
  { shell: 'powershell', command: "[Console]::Error.WriteLine('中文错误信息')" },
  (s) => assert.match(s.stderr, /中文错误信息/),
);
browser({ action: 'open', url }, (s) => {
  assert.ok(s.controls.some((c) => c.id === 'ok'));
  assert.ok(s.errors.includes('test-console-marker'));
});
browser({ action: 'fill', selector: '#name', text: inputText });
browser({ action: 'click', selector: '#ok' }, (s) => assert.equal(s.title, inputText));
browser(
  { action: 'resize', width: 420, height: 560 },
  (s, b) => {
    assert.equal(s.width, 420);
    assert.equal(s.horizontalOverflow, false);
    assert.ok(hasImage(b));
  },
  true,
);
browser({ action: 'close' }, (s) => assert.ok(s.closed));
if (process.argv.includes('--ticket-review')) {
  browser({action:'open',url:'http://127.0.0.1:28761/review.html'}, state => assert.ok(state.controls.some(c=>c.id==='user')));
  browser({action:'fill',selector:'#user',text:'qa_agent'});
  browser({action:'fill',selector:'#pass',text:'invalid'});
  browser({action:'click',selector:'#auth button'},state => assert.ok(state.controls.some(c=>c.id==='pass')));
  browser({action:'fill',selector:'#pass',text:'QA#5752d238'});
  browser({action:'click',selector:'#auth button'});
  browser({action:'inspect'},state=>assert.match(state.text,/T-1001/));
  browser({action:'click',selector:'#logout'});
  browser({action:'close'},state=>assert.ok(state.closed));
}
if (process.argv.includes('--existing-app')) {
  const marker='CShell-App-QA-'+randomUUID().slice(0,8);
  const note=join(data,marker+'.txt');
  await writeFile(note,'本机应用开关验证','utf8');
  const command=[
    "$ErrorActionPreference='Stop'",
    "$old=@(Get-Process notepad -ErrorAction SilentlyContinue | ForEach-Object Id)",
    "Start-Process notepad.exe -ArgumentList '"+JSON.stringify(note).replace(/\\/g,'\\').replaceAll("'","''")+"'",
    "$owned=$null",
    "for($i=0;$i -lt 50 -and !$owned;$i++){Start-Sleep -Milliseconds 180;$owned=Get-Process notepad -ErrorAction SilentlyContinue | Where-Object {$old -notcontains $_.Id -and $_.MainWindowTitle -like '*"+marker+"*'} | Select-Object -First 1}",
    "if(!$owned){throw '未找到独立的验收记事本窗口'}",
    "$pidOpened=$owned.Id",
    "if(!$owned.CloseMainWindow()){throw '关闭窗口失败'}",
    "if(!$owned.WaitForExit(8000)){throw '独立记事本进程未退出'}",
    "[Console]::WriteLine($pidOpened)"
  ].join('\n');
  add('command',{command,timeoutMs:25000},state=>{assert.equal(state.exitCode,0,state.stderr);assert.match(state.stdout.trim(),/^\d+$/);console.log('Verified Notepad process',state.stdout.trim(),'opened and exited')});
}
const env = { ...process.env, CSHELL_TEST_DATA: data, CSHELL_TEST_START_GATE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await _electron.launch({
    executablePath: resolve(process.argv[2]),
    args: process.argv.includes('--dev') ? [resolve('.')] : [],
    env,
  });
  const p = await app.firstWindow({ timeout: 60000 });
  await p.waitForFunction(() => !!window.cshell);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  const thread = await p.evaluate(
    async ({ url, port, password, id, model }) => {
      const a = window.cshell;
      await a.pluginInstall('cshell.agent');
      await a.aiProviderSave({ id: model, name: '测试', url: url + '/v1', model: 'fixture' }, '');
      await a.saveProfile({
        id,
        name: '验收 SSH',
        host: '127.0.0.1',
        port,
        username: 'tester',
        auth: 'password',
        group: '',
        favorite: false,
      });
      const { sessionId } = await a.connect(id, { password, remember: false });
      await a.aiPolicySave({
        ...(await a.aiSnapshot()).policy,
        profiles: [id],
        capabilities: ['files.read', 'files.create'],
      });
      return a.aiThreadCreate('workspace', model, 'allow', sessionId);
    },
    { url, port: ssh.port, password: ssh.password, id: randomUUID(), model: randomUUID() },
  );
  form = launchForm();
  await new Promise((r) => setTimeout(r, 1700));
  await p.evaluate(
    (id) => window.cshell.aiSend(id, '验证桌面表单、浏览器交互、测试页和 SSH 文件往返'),
    thread.id,
  );
  for (let i = 0; i < 600; i++) {
    if (failure) throw failure;
    const state = await p.evaluate(
      async (id) => (await window.cshell.aiSnapshot()).threads.find((t) => t.id === id)?.state,
      thread.id,
    );
    if (state === 'idle') break;
    if (state === 'error')
      throw (
        failure ??
        Error(
          'CShell 任务失败: ' +
            (await p.evaluate(
              async (id) =>
                (await window.cshell.aiSnapshot()).threads.find((t) => t.id === id)?.messages.at(-1)
                  ?.content,
              thread.id,
            )),
        )
      );
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(index, actions.length + 1);
  assert.deepEqual(await readFile(copy), bytes);
  assert.deepEqual(await readFile(join(ssh.root, '数据.bin')), bytes);
  console.log(
    'Verified Windows Forms focus/input/accessibility, Chinese stderr, Chromium form/viewport/screenshot and 500000-byte SSH round trip.',
  );
} finally {
  form?.kill();
  await app?.close();
  await ssh.close();
  server.close();
}
