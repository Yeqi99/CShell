import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'cshell-desktop-locale-'));
await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{LinuxDesktop}from'./src/ui/components/LinuxDesktop';import{PingAll}from'./src/ui/components/PingAll';import{LocaleContext}from'./src/ui/i18n';import './src/ui/styles.css';import './src/ui/theme.css';
window.cshell={networkPing:async()=>({status:'reply',elapsedMs:10}),desktopLookGet:async()=>({name:'海岸',theme:'light',wallpaper:'coast'}),desktopLookSave:async()=>{}};
function App(){const[locale,setLocale]=useState('en-US');return <LocaleContext.Provider value={locale}><button id="locale" onClick={()=>setLocale(v=>v==='en-US'?'zh-CN':'en-US')}>Locale</button><PingAll profiles={[]} onInterval={async()=>{}}/><div style={{height:'calc(100vh - 32px)'}}><LinuxDesktop name="我的美国机器" machine={{deviceId:'fixture',platform:'linux'}} target="fixture" call={async()=>({engines:[]})} active extraPanels={[{id:'remote',label:'远程控制',content:<div/>},{id:'native-desktop',label:'原生桌面',content:<div/>},{id:'custom-fixture',label:'自定义应用',content:<div/>}]}/></div></LocaleContext.Provider>}createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,jsx:'automatic',outfile:join(dir,'fixture.js')});
await writeFile(join(dir,'index.html'),'<html data-theme="light"><head><link rel="stylesheet" href="fixture.css"></head><body style="margin:0"><div id="root"></div><script src="fixture.js"></script></body></html>');
await writeFile(join(dir,'main.cjs'),`const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(dir,'data'))});app.whenReady().then(()=>new BrowserWindow({width:700,height:800,show:false,webPreferences:{contextIsolation:true,sandbox:true}}).loadFile(${JSON.stringify(join(dir,'index.html'))}));`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[join(dir,'main.cjs')],env});
try{
 const page=await app.firstWindow();page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await mkdir('test-results/desktop-locale-020',{recursive:true});
 for(const width of [700,390,320]){
  await app.evaluate(({BrowserWindow},w)=>BrowserWindow.getAllWindows()[0].setContentSize(w,800),width);
  await page.locator('[data-desktop-icon="browser"]').waitFor();
  assert.equal((await page.locator('[data-desktop-icon="browser"]').innerText()).trim(),'Browser');
  assert.equal((await page.locator('[data-desktop-icon="remote"]').innerText()).trim(),'Remote control');
  assert.equal((await page.locator('[data-desktop-icon="native-desktop"]').innerText()).trim(),'Native desktop');
  assert.equal((await page.locator('[data-desktop-icon="custom-fixture"]').innerText()).trim(),'自定义应用');
  await page.getByRole('button',{name:'Open apps menu',exact:true}).click();
  assert((await page.locator('.desktop-start').innerText()).includes('我的美国机器'));
  assert(!(await page.locator('.desktop-start').innerText()).includes('远程控制'));
  await page.getByRole('button',{name:'Open apps menu',exact:true}).click();
  const ping=page.getByRole('button',{name:'Ping all servers from this device',exact:true});assert.equal((await ping.innerText()).trim(),'');
  await ping.click({button:'right'});const popup=page.getByRole('dialog',{name:'Automatic ping settings'});await popup.waitFor();
  const bounds=await popup.boundingBox(),viewport=await page.evaluate(()=>innerWidth);assert(bounds&&bounds.x>=0&&bounds.x+bounds.width<=viewport+1);assert.equal(await ping.getAttribute('title'),null);
  await page.screenshot({path:'test-results/desktop-locale-020/en-'+width+'.png'});await page.keyboard.press('Escape');
 }
 await page.locator('[data-desktop-icon="settings"]').dblclick();await page.getByRole('heading',{name:'Personalization',exact:true}).waitFor();
 assert.equal(await page.getByLabel('Preset name',{exact:true}).inputValue(),'海岸','saved preset names are not translated');
 await page.locator('#locale').click();await page.getByRole('heading',{name:'个性化',exact:true}).waitFor();
 assert.equal((await page.locator('[data-desktop-icon="browser"]').innerText()).trim(),'浏览器');
 await page.screenshot({path:'test-results/desktop-locale-020/zh-320.png'});assert.deepEqual(errors,[]);
 console.log('PASS actual Electron en/zh desktop labels, custom names, menus, icon-only Ping bounds at 320/390/700 CSS px');
}finally{await app.close();await rm(dir,{recursive:true,force:true});}
