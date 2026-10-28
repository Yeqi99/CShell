const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
(async()=>{
 const root=path.resolve('services/portal');fs.mkdirSync('test-results/download-selector',{recursive:true});
 const source=fs.readFileSync(path.join(root,'downloads.html'),'utf8'),previous=execFileSync('git',['show','HEAD:services/portal/downloads.html'],{encoding:'utf8'});
 const assets=html=>[...html.matchAll(/<article class="download-package"[\s\S]*?<\/article>/g)].map(m=>({url:m[0].match(/class="secondary" href="([^"]+)"/)[1],digest:m[0].match(/sha256:([a-f0-9]{64})/)[1]}));
 assert.deepEqual(assets(source),assets(previous),'Existing attachments and checksums must remain identical');
 const server=http.createServer((q,r)=>{const file=path.resolve(root,'.'+new URL(q.url,'http://local').pathname);if(!file.startsWith(root+path.sep)){r.writeHead(403).end();return;}try{r.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');r.end(fs.readFileSync(file));}catch{r.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=process.env.PORTAL_ORIGIN||'http://127.0.0.1:'+server.address().port;
 const bs=await chromium.launchServer({channel:'msedge'});let browser;
 try{browser=await chromium.connect(bs.wsEndpoint());const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1440,700,390,320]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/downloads.html?product=pro&system=linux&arch=arm64');
  assert(await page.locator('#linux-command').isVisible());assert((await page.locator('#linux-install-command').textContent()).endsWith('cshell --channel pro'));
  const visible=page.locator('.download-package:visible');assert.equal(await visible.count(),2);for(const href of await visible.locator('a.secondary').evaluateAll(a=>a.map(n=>n.getAttribute('href'))))assert(href.includes('linux-arm64'));
  await page.locator('#download-architecture').selectOption('x64');assert.equal(await visible.count(),2);assert.equal(new URL(page.url()).searchParams.get('arch'),'x64');
  for(const card of await visible.all()){assert.equal(await card.getAttribute('data-arch'),'x64');await card.locator('summary').click();}
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));for(const code of await visible.locator('code').all())assert(await code.evaluate(e=>e.getBoundingClientRect().right<=e.closest('details').getBoundingClientRect().right+1),'Checksum must fit its own column');await page.screenshot({path:`test-results/download-selector/linux-${width}.png`,fullPage:true});
  await page.getByRole('radio',{name:'Windows',exact:true}).check();assert(await page.locator('#linux-command').isHidden());assert.equal(await visible.count(),1);assert(await page.locator('.architecture-filter').isHidden());assert.equal(new URL(page.url()).searchParams.get('arch'),null);
  await page.getByRole('radio',{name:/CAgent/}).check();await page.getByRole('radio',{name:'Android',exact:true}).check();assert.equal(await visible.count(),0);assert(await page.locator('#download-empty').isVisible());
  await page.goto(origin+'/downloads.html?product=pro&system=macos&arch=x64');assert.equal(await visible.count(),1);assert((await visible.locator('a.secondary').getAttribute('href')).endsWith('mac-x64.dmg'));
  await page.locator('#download-architecture').selectOption('arm64');assert((await visible.locator('a.secondary').getAttribute('href')).endsWith('mac-arm64.dmg'));await page.reload();assert.equal(await page.locator('#download-architecture').inputValue(),'arm64');
  await page.goto(origin+'/downloads.html?product=unknown&system=invalid&arch=evil');assert.equal(await page.locator('input[name=download-product][value=pro]').isChecked(),true);assert.equal(await page.locator('#download-architecture').inputValue(),'all');assert(await visible.count()>1);
 }
 await page.goto(origin+'/downloads.html?product=cagent&system=linux');assert((await page.locator('#linux-install-command').textContent()).endsWith('-- cagent'));await page.getByRole('radio',{name:/开源版/}).check();assert((await page.locator('#linux-install-command').textContent()).endsWith('-- cshell'));
 const nojs=await browser.newContext({javaScriptEnabled:false});try{const page=await nojs.newPage();await page.goto(origin+'/downloads.html');assert.equal(await page.locator('.download-package:visible').count(),assets(source).length);}finally{await nojs.close();}
 assert.deepEqual(errors,[]);console.log('PASS: unchanged attachment URLs/digests; Linux/macOS architecture selection, share/reload, Windows reset, CAgent Android empty state, invalid query fallback, no-JS all packages; 1440/700/390/320px and expanded checksums; no JS errors');
 }finally{await bs.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
