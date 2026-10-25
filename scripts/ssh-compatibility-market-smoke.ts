import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const directory=await mkdtemp(join(tmpdir(),'cshell-ssh-compat-ui-'));
await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import {AgentApplications} from './src/ui/components/AgentApplications';
import {MachineInformation} from './src/ui/components/MachineInformation';
import './src/ui/styles.css';
window.plans=[];window.installs=[];
window.cshell={jobs:async()=>[],environments:async()=>({conda:'/home/alice/miniconda3/bin/conda',python:'/usr/bin/python3',environments:[]}),applicationPlan:async(id,input)=>{window.plans.push({id,input});return{id:'approved-plan',sessionId:id,label:'Nginx',app:input.app,command:'apt-get install nginx',expires:Date.now()+900000};},applicationInstall:async id=>{window.installs.push(id);return{id:'install-job',sessionId:'real-session',label:'Nginx',state:'running',output:'Checking package',started:Date.now()};},cancelJob:async()=>{}};
const call=async(method)=>{
 if(method==='coding.status')return{supported:false,compatibility:'此机器的 CAgent 暂未提供这项能力；已保留现有连接和运行任务。'};
 if(method==='ide.status')return{supported:true,ready:true,directory:'/data/editor',version:'1.0'};
 if(method==='applications.list')return{platform:'linux',manager:'apt-get',enabled:false,applications:[{id:'git',package:'git'}]};
 if(method==='applications.policy')throw Error('不支持的 Agent 管理操作');
 if(method==='machine.snapshot')return{source:'ssh',hostname:'Fixture Linux',platform:'linux',arch:'x64',release:'6.8',at:Date.now(),uptime:3600,cpu:[{model:'Actual fixture CPU',mhz:3200,user:10,sys:4,idle:80,total:94}],memory:{total:8589934592,available:4294967296,free:2147483648},network:[],disks:'/dev/root 10G 5G',processes:'',ports:'',gpu:'',errors:{gpu:'系统未提供此数据'}};
 throw Error('unexpected '+method);
};
createRoot(document.getElementById('app')).render(<><AgentApplications target={{id:'ssh:real-session',name:'Linux target'}} call={call}/><MachineInformation call={call} active={true} closed={false}/></>);
`},bundle:true,jsx:'automatic',loader:{'.svg':'dataurl','.png':'dataurl','.woff2':'dataurl'},outfile:join(directory,'fixture.js')});
const browser=await chromium.launch({channel:process.env.CI?undefined:'msedge'});
try{
 const page=await browser.newPage({viewport:{width:1100,height:900}}),errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://fixture.invalid/',r=>r.fulfill({body:'<div id="app"></div>',contentType:'text/html'}));await page.goto('https://fixture.invalid/');
 await page.addStyleTag({content:await readFile(join(directory,'fixture.css'),'utf8')});await page.addScriptTag({content:await readFile(join(directory,'fixture.js'),'utf8')});
 await page.getByText('SSH 实时采集',{exact:false}).waitFor();
 await page.getByRole('button',{name:'代码编辑器',exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'保存权限',exact:true}).count(),0,'SSH cannot expose Agent policy mutation');
 assert.equal(await page.getByText('Invalid enum',{exact:false}).count(),0);
 await page.getByRole('button',{name:'Nginx',exact:false}).click();
 await page.getByRole('button',{name:'检查安装条件',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>(window as any).installs),[],'inspection never installs');
 assert.equal(await page.evaluate(()=>(window as any).plans[0].id),'real-session');
 await page.getByRole('button',{name:'确认安装',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>(window as any).installs),['approved-plan']);
 await mkdir('.local/release-089',{recursive:true});await page.screenshot({path:'.local/release-089/ssh-compatibility-market.png',fullPage:true});
 await page.setViewportSize({width:390,height:800});
 const dimensions=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));
 assert(dimensions.width<=dimensions.viewport+2,JSON.stringify(dimensions));
 assert.deepEqual(errors,[]);
 console.log('SSH compatibility market: partial Agent catalog retained; independent SSH plan/confirm works; machine snapshot source shown; 390px fits.');
}finally{await browser.close();}
