// Real React desktop + TabStrip regressions; no remote machine or user data involved.
const esbuild=require('esbuild'),{chromium}=require('playwright'),assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),http=require('http');
(async()=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'cshell-native-ui-'));
 await esbuild.build({entryPoints:['tests/fixtures/native-desktop-ui.tsx'],bundle:true,outfile:path.join(output,'test.js'),jsx:'automatic',define:{__CSHELL_PRO__:'false'},loader:{'.png':'dataurl','.svg':'dataurl'}});
 const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<div id="root"></div><link rel="stylesheet" href="/test.css"><script src="/test.js"></script>')}else if(['/test.js','/test.css'].includes(req.url))res.end(fs.readFileSync(path.join(output,req.url.slice(1))));else{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('#request').click();await page.locator('#native-content').waitFor({state:'visible'});
  await page.getByRole('button',{name:'关闭原生桌面窗口',exact:true}).click();await page.locator('#native-content').waitFor({state:'hidden'});
  await page.locator('#request').click();await page.locator('#native-content').waitFor({state:'visible'});
  for(const font of [15,22,28]){await page.evaluate(f=>document.documentElement.style.setProperty('--ui-font-size',f+'px'),font);const visible=await page.locator('.tabs').evaluate(el=>{const b=el.getBoundingClientRect();return [...el.children].filter(t=>{const a=t.getBoundingClientRect();return a.left>=b.left&&a.right<=b.right+1}).length});assert(visible>=3,`At ${font}px fewer than three tabs fit`);}
  await page.locator('#overflow').click();await page.waitForFunction(()=>{const el=document.querySelector('.tabs'),a=el.querySelector('.active').getBoundingClientRect(),b=el.getBoundingClientRect();return el.scrollLeft>0&&a.right<=b.right+1});
  assert(await page.getByRole('button',{name:'查看左侧标签',exact:true}).isEnabled());
  await page.locator('#first').click();await page.waitForFunction(()=>{const e=document.querySelector('.tabs');return e.querySelector('.active').getBoundingClientRect().left>=e.getBoundingClientRect().left-1});
  await page.locator('.tabs').hover();await page.mouse.wheel(0,240);await page.waitForFunction(()=>document.querySelector('.tabs').scrollLeft>0);
  assert.deepEqual(errors,[]);console.log('PASS: native window opens/reopens; 600px tabs at 15/22/28px; active tab reveal and horizontal wheel navigation');
 }finally{await browser.close();await new Promise(r=>server.close(r));fs.rmSync(output,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
