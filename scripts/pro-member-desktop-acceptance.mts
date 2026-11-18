import { _electron } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
const root=join(homedir(),'Documents','CShell-Pro-QA','会员交付-'+randomUUID().slice(0,8));
await mkdir(root,{recursive:true});
const env={...process.env,CSHELL_TEST_DATA:join(process.env.APPDATA!,'CShell Pro'),CSHELL_TEST_START_GATE:'1'};delete env.ELECTRON_RUN_AS_NODE;
if(!process.argv[2])throw Error('请传入已安装的 CShell Pro 可执行文件路径');
const app=await _electron.launch({executablePath:process.argv[2],env,args:[],timeout:60000});
const page=await app.firstWindow({timeout:60000});await page.waitForFunction(()=>!!window.cshell?.aiSnapshot);
const catalog=await page.evaluate(async()=>{
 const a=window.cshell;const status=await a.cloudStatus();if(!status.membership?.active)throw Error('Pro 会员状态未生效');
 const plugins=await a.plugins();const agent=plugins.find(p=>p.manifest.id==='cshell.agent');
 if(!agent)await a.pluginInstall('cshell.agent');else if(!agent.enabled)await a.pluginToggle('cshell.agent',true);
 for(let i=0;i<30;i++){const s=await a.aiSnapshot();const pool=s.providers.filter(p=>p.url==='https://shell.canp.ai/api/v1/models/chat/completions' && p.model==='pool-'+p.id);if(pool.length)return pool.map(p=>({id:p.id,name:p.name}));await new Promise(r=>setTimeout(r,1000));}throw Error('会员模型目录为空');
});
console.log('CATALOG',JSON.stringify(catalog.map(p=>p.name)),'ROOT',root);
const ids=new Map<string,string>();
async function submit(key:string,msg:string){
 const id=ids.get(key)!;await page.evaluate(({id,msg})=>window.cshell.aiSend(id,msg),{id,msg});
}
async function start(key:string,model:string,brief:string){
 const p=catalog.find(p=>p.name.toLowerCase().includes(model));if(!p)throw Error('未找到模型 '+model);
 const t=await page.evaluate(async id=>window.cshell.aiThreadCreate('workspace',id,'allow'),p.id);
 ids.set(key,t.id);await submit(key,brief);console.log('START',key,p.name,t.id);
}
const common='仅使用当前 Windows 本机的 CShell cagent 工具。禁止远程连接、账号消费、下载外部程序、操作用户私人数据；只在下述新目录创建文件与操作本次生成的进程。使用 local_desktop_command（可通过 load_task_context 加载）在 PowerShell 中分段写源码、编译、启动、测试。用本机已有 Windows .NET Framework csc.exe 编译原生 GUI，或用 WPF XAML 与独立桌面启动入口；不要求安装全局 SDK。不要仅展示代码，必须实际落盘。生成 README 写清构建启动及测试凭据。界面要有清晰的主操作、统一对齐留白、筛选/空态/错误反馈、键盘可操作、适配缩放；禁止只有 mock 和演示按钮。使用真实数据持久化。每项修改后实际验证；完成前从自身应用获得截图（使用本程序窗口而非无关桌面），检查至少一个可用性问题并改进，保留前后图或验收记录。若截图可能包含其他程序，只获取自己窗口。';
const one=join(root,'工单台'),two=join(root,'资产台账');
await mkdir(one);await mkdir(two);
await start('工单','deepseek-v4-flash',common+' 项目目录 '+one+'。交付中文售后工单桌面工作台。应支持创建、优先级筛选、完成、重开、查询；开发独立本地 Node HTTP 服务，监听 127.0.0.1:28761，持久化 JSON，提供 /health、登录以及受保护的工单读写 API；桌面端必须对接真实 API。本地部署并验证未登录拒绝、登录成功、创建/状态变更、重启保留。另做一个简洁的浏览器登录及查询页，使用 local_desktop_browser 打开、填写测试账号登录、读取你生成的工单数据，核对 API 返回。测试账户限定仅用于此应用。保留可执行成品和源码。');
await start('资产','minimax-m3',common+' 项目目录 '+two+'。开发另一个独立桌面产品：中文设备资产台账（资产编号、名称、责任人、类别和领用状态），添加、编辑、搜索、借还、CSV 导入导出、防重复编号。使用合成数据测试中文、带逗号和引号的字段；保留可执行成品和源码。通过本机能力启动自己生成的应用、确认窗口、关闭、重新打开并验证持久化；对已有 Windows 应用的开关控制仅限你新启动的记事本并核验 PID，不要关闭已有用户窗口。完成至少一次实际 UI 验证后的迭代。');
async function status(){
 const s=await page.evaluate(async(ids)=>{const snap=await window.cshell.aiSnapshot();return ids.map(id=>{const t=snap.threads.find(t=>t.id===id)!;const m=t.messages.at(-1);return {id,model:snap.providers.find(p=>p.id===t.providerId)?.name,state:t.state,error:t.error,pending:t.pending?.tool,count:t.messages.length,last:m?.tool?{tool:m.tool.name,output:m.tool.output.slice(-380)}:m?.content?.slice(-680)}})},[...ids.values()]);
 console.log('STATE',JSON.stringify(s));await writeFile(join(root,'验收会话.json'),JSON.stringify({threads:s},null,2));
}
let seen='';const timer=setInterval(async()=>{try{const v=await page.evaluate(async(ids)=>{const ts=(await window.cshell.aiSnapshot()).threads;return ids.map(id=>{const t=ts.find(t=>t.id===id);return [t?.state,t?.messages.length,t?.pending?.tool,t?.messages.at(-1)?.tool?.name]})},[...ids.values()]);const key=JSON.stringify(v);if(key!==seen){seen=key;console.log('STEP',key)}}catch{}},12000);
const rl=createInterface({input:process.stdin,output:process.stdout,terminal:false});
for await(const line of rl){try{const cmd=JSON.parse(line);if(cmd.status)await status();if(cmd.key&&cmd.msg)await submit(cmd.key,cmd.msg);if(cmd.close){await status();break}}catch(e){console.log(String(e))}}
clearInterval(timer);await app.close();
