#!/usr/bin/env node
import {startSshBridge} from './ssh-bridge';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, stderr } from 'node:process';
import { createAgentRuntime } from './runtime';
import { callAgent, discoverAgent } from './control';
import { agentDirectory } from './storage';
import { detectAgentShells } from '../core/agent-terminal';
import { startCagentApp, openCagentApp } from './app';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

async function jsonInput() {
  if (stdin.isTTY) throw new Error('请通过标准输入提供 JSON；不要将密码写入命令参数');
  let input = '';
  for await (const chunk of stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 1048576) throw new Error('输入过大');
  }
  return JSON.parse(input);
}
async function secret(prompt: string) {
  stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const finish = () => {
      stdin.off('data', data);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write('\n');
    };
    const data = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          finish();
          reject(new Error('已取消'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ' && value.length < 128) value += character;
      }
    };
    stdin.on('data', data);
  });
}
const print = (value: unknown) => stdout.write(JSON.stringify(value, null, 2) + '\n');
async function main() {
  const [command = 'help', method] = process.argv.slice(2);
  if(command==='bridge'){startSshBridge();return;}
  if(command==='app'&&process.platform==='win32'&&existsSync(join(dirname(process.argv[1]),'Cagent.exe'))){
    const child=spawn(join(dirname(process.argv[1]),'Cagent.exe'),[],{detached:true,stdio:'ignore',windowsHide:false});
    await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();return;
  }
  if(command==='restart-app-host'){
    try{await callAgent('agent.shutdown',{confirm:true});}catch(error){if((error as Error).message!=='本机 Agent 未运行'&&(error as NodeJS.ErrnoException).code!=='ECONNREFUSED')throw error;}
    const deadline=Date.now()+30000;
    for(;;){
      try{await callAgent('client.status');}catch(error){if((error as Error).message==='本机 Agent 未运行'||(error as NodeJS.ErrnoException).code==='ECONNREFUSED')break;throw error;}
      if(Date.now()>=deadline)throw new Error('旧后台尚未退出，请稍后重试');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
  if(command==='app'||command==='app-host'||command==='restart-app-host'){
    let runtime:Awaited<ReturnType<typeof createAgentRuntime>>|undefined;
    let app:Awaited<ReturnType<typeof startCagentApp>>|undefined;
    let runtimeHasClosed=false;
    const runtimeClosed=async()=>{
      runtimeHasClosed=true;
      try{await app?.close();}
      finally{
        // Native owners keep this pipe open while the window is hidden. Once
        // the authenticated runtime shutdown finishes, it must not keep an
        // otherwise closed app-host process alive. Hiding the window does not
        // call this callback and still preserves the background runtime.
        if(command!=='app')stdin.destroy();
      }
    };
    try{await callAgent('client.status');}catch(error){
      if((error as Error).message!=='本机 Agent 未运行'&&(error as NodeJS.ErrnoException).code!=='ECONNREFUSED')throw error;
      runtime=await createAgentRuntime({onClose:()=>{void runtimeClosed().catch(error=>stderr.write('CAgent 界面关闭失败：'+String(error)+'\n'));}});
      await runtime.startControl();
    }
    try{if(runtimeHasClosed)return;app=await startCagentApp();if(runtimeHasClosed){await app.close();return;}if(command!=='app'){stdout.write(JSON.stringify({url:app.url})+'\n');stdin.resume();stdin.on('end',()=>{void app?.close();});}else await openCagentApp(app.url);}catch(error){await app?.close();await runtime?.close();throw error;}
    stderr.write('CAgent 本机界面已就绪；使用 cagent shutdown 退出运行时。\n');
    const stop=()=>{void app?.close().then(()=>runtime?.close());};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    return;
  }
  if (command === 'help' || command === '--help') {
    stdout.write(
      `CAgent (Canp Agent)\n\napp        打开独立本机智能体界面（Windows 原生窗口；其他系统使用浏览器）\ninit       本机初始配置（交互输入密码；不启动远程监听）\nrun        前台运行后台服务，允许当前用户的 CShell 管理\nstatus     查看状态\nstart      从标准输入读取 {"bind":"127.0.0.1","port":24443} 并开启监听\nstop       关闭远程监听和已连接会话\nlogs       查看审计日志\nshutdown   退出 Agent 进程\nshells     检测本机 Shell 与 WSL\ncall METHOD  从标准输入读取参数并执行本机管理操作\nrecover    显示本机恢复方法（不删除身份、凭据或授权）\n\n数据目录：${agentDirectory()}\n`,
    );
    return;
  }
  if (command === 'shells') {
    print(await detectAgentShells());
    return;
  }
  if (command === 'recover') {
    stdout.write(
      `在同一系统用户下运行 cagent run，再运行 cagent stop 后重新配置。\n若服务尚未运行，先执行 run；不要删除数据目录。\n保留并备份整个目录（包括 vault-key），以保留设备身份和授权：${agentDirectory()}\nWindows 密钥仅原系统用户可解密。WSL 需管理员时，明确以管理员运行；不会自动提权或重启。\n`,
    );
    return;
  }
  if (command === 'init') {
    const existing = await discoverAgent();
    if (existing) {
      let running = false;
      try {
        await callAgent('client.status');
        running = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED') throw error;
      }
      if (running)
        throw new Error('Agent 已运行，请在 CShell 配置页初始化；或先 shutdown 后运行 init');
    }
    const runtime = await createAgentRuntime();
    try {
      if (runtime.server.status().passwordConfigured)
        throw new Error('已存在配置，请运行服务后通过 CShell 修改');
      let config: unknown;
      if (stdin.isTTY) {
        const available = await runtime.terminal.shells();
        const shells = [...new Set(available.map((s) => (s.environment === 'wsl' ? 'wsl' : s.id)))];
        stderr.write('可用 Shell：' + shells.join(', ') + '\n');
        const reader = createInterface({ input: stdin, output: stderr });
        const selected = (await reader.question('允许的 Shell（逗号分隔，必须明确选择）：'))
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        reader.close();
        if (!selected.length || selected.some((s) => !shells.includes(s)))
          throw new Error('请选择检测到的 Shell');
        const password = await secret('连接密码：');
        if (password !== (await secret('再次输入密码：'))) throw new Error('两次密码不一致');
        config = {
          password,
          shells: selected,
          allowHttp: false,
          allowManage: false,
          allowHosting: false,
          allowRelay: false,
        };
      } else config = await jsonInput();
      print(await runtime.dispatch('client.access', config));
    } finally {
      await runtime.close();
    }
    return;
  }
  if (command === 'run') {
    const runtime = await createAgentRuntime();
    try {
      await runtime.startControl();
    } catch (error) {
      await runtime.close();
      throw error;
    }
    stderr.write('CAgent 已运行；远程监听保持关闭，由本机配置明确启动。\n');
    const stop = () => {
      void runtime.close().catch((error) => {
        stderr.write(String(error) + '\n');
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return;
  }
  const commands: Record<string, string> = {
    status: 'client.status',
    start: 'client.start',
    stop: 'client.stop',
    logs: 'agent.logs',
    shutdown: 'agent.shutdown',
  };
  if (command === 'call') {
    if (!method) throw new Error('缺少管理操作名称');
    print(await callAgent(method, await jsonInput()));
    return;
  }
  const selected = commands[command];
  if (!selected) throw new Error('未知命令；运行 cagent help 查看用法');
  print(
    await callAgent(
      selected,
      command === 'start'
        ? await jsonInput()
        : command === 'shutdown'
          ? { confirm: true }
          : undefined,
    ),
  );
}
main().catch((error) => {
  stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
});
