import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Real React/FilePanel/CodeMirror components against an isolated bridge, never user credentials.
const directory=await mkdtemp(join(tmpdir(),'cshell-file-workspace-'));
await build({stdin:{contents:`
import React,{useState}from'react';import{createRoot}from'react-dom/client';import'./src/ui/styles.css';
import{FileConnectionWorkspace}from'./src/ui/components/FileConnectionWorkspace';
window.actions=[];const item=(name,directory=false)=>({name,path:'/fixture/'+name,directory,symlink:false,size:4096,modified:name==='notes.txt'?0:1761300000000});let entries=[item('documents',true),item('notes.txt'),item('script.py')];
window.cshell={
 list:async(id,path)=>{window.actions.push(['list',id,path]);if(path==='/bad')throw Error('Fixture listing denied');return{path:path.includes('documents')?'/fixture/documents':'/fixture',entries:path.includes('documents')?[]:[...entries]};},
 fileAction:async(id,action,path,destination)=>{window.actions.push(['action',id,action,path,destination]);if(action==='mkdir')entries.push(item(path.split('/').pop(),true));if(action==='rename')entries=entries.map(entry=>entry.path===path?{...entry,name:destination.split('/').pop(),path:destination}:entry);if(action==='delete')entries=entries.filter(entry=>entry.path!==path);},
 upload:async(id,path,tokens)=>{window.actions.push(['upload',id,path,tokens]);},download:async(id,paths)=>{window.actions.push(['download',id,paths]);},droppedFiles:files=>files.map(file=>'isolated-token:'+file.name),copyText:async text=>{window.actions.push(['copy',text]);},
 cancelTransfer:async(id)=>{window.actions.push(['cancel',id]);},
 events:()=>()=>{},plugins:async()=>{window.actions.push(['plugins']);return[];},textEnvironments:async()=>{window.actions.push(['environment']);throw Error('Must not query execution environment for SFTP');},
 textReadFile:async(id,path)=>{window.actions.push(['read',id,path]);return{code:'saved fixture content',revision:'fixture-revision'};},textSaveFile:async(id,path,code,revision)=>{window.actions.push(['save',id,path,code,revision]);return{revision:'new-fixture-revision'};},
};
function App(){const[protocol,setProtocol]=useState('ftp'),[closed,setClosed]=useState(false);window.setProtocol=setProtocol;window.setClosed=setClosed;
const profile={id:'fixture',protocol,name:'隔离文件连接',host:'fixture.invalid',port:protocol==='sftp'?22:21,username:'fixture',auth:'password',favorite:false,group:''};
const transfers=[{id:'transfer-fixture',sessionId:protocol,name:'upload.bin',direction:'upload',done:1024,total:4096,state:'running'},{id:'other',sessionId:'unrelated-session',name:'never-display.txt',direction:'download',done:0,total:10,state:'failed',error:'never-display-error'}];
return <div style={{display:'flex',gap:12,padding:12,height:'100vh'}}><main id="workspace" style={{width:700,height:'100%',flexShrink:0}}><FileConnectionWorkspace key={protocol} sessionId={protocol} profile={profile} closed={closed} transfers={transfers} onError={error=>window.actions.push(['error',String(error)])} onRetry={()=>window.actions.push(['retry',protocol])}/></main><aside style={{width:280,padding:20,background:'var(--panel)'}}><h2>智能体</h2><textarea aria-label="并存草稿" defaultValue="另一面板草稿保留"/></aside></div>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,jsx:'automatic',outfile:join(directory,'app.js'),loader:{'.woff2':'dataurl','.svg':'dataurl'}});
const server=createServer(async(request,response)=>{const name=request.url==='/app.js'?'app.js':request.url==='/app.css'?'app.css':undefined;response.setHeader('Content-Type',name?name.endsWith('.js')?'text/javascript':'text/css':'text/html;charset=utf-8');response.end(name?await readFile(join(directory,name)):'<html data-theme="light"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
try{
 const page=await browser.newPage({viewport:{width:1280,height:850}}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}`);await page.getByRole('option',{name:/notes.txt/}).waitFor();
 assert.equal(await page.locator('.xterm,.monitor-panel').count(),0);assert.equal(await page.getByText('never-display.txt').count(),0);
 assert.equal(await page.getByRole('option',{name:/notes.txt/}).locator('time').innerText(),'—');
 await page.getByRole('option',{name:/notes.txt/}).click();await page.getByRole('option',{name:/script.py/}).click({modifiers:['Control']});
 assert.equal(await page.getByRole('option',{selected:true}).count(),2);await page.getByRole('button',{name:'下载',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.actions.find(action=>action[0]==='download')),['download','ftp',['/fixture/notes.txt','/fixture/script.py']]);
 await page.getByRole('option',{name:/documents/}).click();assert(await page.getByRole('button',{name:'下载',exact:true}).isDisabled());
 await page.getByRole('button',{name:'上传文件',exact:true}).click();await page.waitForFunction(()=>window.actions.some(action=>action[0]==='upload'));
 await page.getByRole('button',{name:'新建目录',exact:true}).click();await page.getByRole('textbox',{name:'目录名称'}).fill('created');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('option',{name:/created/}).waitFor();
 await page.getByRole('option',{name:/notes.txt/}).click();await page.getByRole('button',{name:'重命名',exact:true}).click();await page.getByRole('textbox',{name:'新名称'}).fill('renamed.txt');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('option',{name:/renamed.txt/}).waitFor();
 await page.getByRole('option',{name:/created/}).click();await page.getByRole('button',{name:'删除',exact:true}).click();assert.equal(await page.evaluate(()=>window.actions.filter(action=>action[0]==='action'&&action[2]==='delete').length),0);await page.getByRole('button',{name:'确认删除',exact:true}).click();await page.waitForFunction(()=>window.actions.some(action=>action[0]==='action'&&action[2]==='delete'));
 await page.getByRole('button',{name:'取消传输 upload.bin'}).click();assert.deepEqual(await page.evaluate(()=>window.actions.find(action=>action[0]==='cancel')),['cancel','transfer-fixture']);
 assert.equal(await page.getByRole('progressbar',{name:'upload.bin 传输进度'}).getAttribute('value'),'1024');
 await page.getByRole('textbox',{name:'路径',exact:true}).fill('/bad');await page.getByRole('textbox',{name:'路径',exact:true}).press('Enter');await page.getByRole('alert').filter({hasText:'Fixture listing denied'}).waitFor();
 await page.getByRole('textbox',{name:'路径',exact:true}).fill('/fixture');await page.getByRole('textbox',{name:'路径',exact:true}).press('Enter');await page.getByRole('option',{name:/renamed.txt/}).waitFor();
 const data=await page.evaluateHandle(()=>{const data=new DataTransfer();data.items.add(new File(['sample'],'drop.txt',{type:'text/plain'}));return data;});await page.locator('.ftp-file-panel').dispatchEvent('drop',{dataTransfer:data});await data.dispose();await page.waitForFunction(()=>window.actions.some(action=>action[0]==='upload'&&action[3]?.[0]==='isolated-token:drop.txt'));
 await mkdir('test-results/file-workspace',{recursive:true});
 for(const width of [320,400,700]){await page.locator('#workspace').evaluate((element,value)=>element.style.width=value+'px',width);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert(await page.locator('.file-connection-workspace').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:`test-results/file-workspace/ftp-${width}.png`});}
 await page.evaluate(()=>window.setClosed(true));await page.getByText('连接已断开',{exact:true}).waitFor();assert.equal(await page.locator('.file-connection-content').getAttribute('inert'),'');assert(await page.getByRole('button',{name:'上传文件',exact:true}).isDisabled());await page.getByRole('button',{name:'重新连接',exact:true}).click();assert((await page.evaluate(()=>window.actions)).some(action=>action[0]==='retry'));
 await page.evaluate(()=>{window.setClosed(false);window.setProtocol('sftp');});await page.locator('.file-row').filter({hasText:'script.py'}).dblclick();await page.locator('.cm-content').waitFor();
 assert.equal(await page.evaluate(()=>window.actions.filter(action=>['environment','plugins'].includes(action[0])).length),0);assert.equal(await page.getByRole('option',{name:'Python',exact:true}).count(),0);
 await page.locator('.cm-content').fill('unsaved SFTP draft');await page.getByRole('button',{name:'文件',exact:true}).click();await page.getByRole('button',{name:'script.py',exact:true}).click();assert.equal(await page.locator('.cm-content').innerText(),'unsaved SFTP draft');
 await page.getByRole('combobox',{name:'同步模式'}).selectOption('live');await page.evaluate(()=>window.setClosed(true));await page.getByText('连接已断开',{exact:true}).waitFor();await page.waitForTimeout(500);
 assert.equal(await page.evaluate(()=>window.actions.filter(action=>action[0]==='save').length),0);assert.equal(await page.locator('.cm-content').innerText(),'unsaved SFTP draft');
 assert(await page.getByRole('button',{name:'保存文件',exact:true}).isDisabled());assert.equal(await page.getByLabel('并存草稿').inputValue(),'另一面板草稿保留');
 await page.screenshot({path:'test-results/file-workspace/sftp-disconnected-draft.png'});assert.deepEqual(errors,[]);
 console.log('PASS FTP multi-select/path/errors/upload/drop/download/mkdir/rename/delete confirmation/queue cancel, responsive 320/400/700, SFTP text editor without environment probes, closed operations and retained drafts');
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
