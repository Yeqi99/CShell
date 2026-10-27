const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve('services/portal'),version=require('../package.json').version;
 fs.mkdirSync('test-results',{recursive:true});
 const server=http.createServer((q,r)=>{const file=path.resolve(root,'.'+new URL(q.url,'http://local').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(root+path.sep)){r.writeHead(403).end();return;}try{const ext=path.extname(file);r.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'})[ext]||'application/octet-stream');r.end(fs.readFileSync(file));}catch{r.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const live=process.env.PORTAL_ORIGIN,origin=live||'http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'msedge',...(live?{proxy:{server:'http://127.0.0.1:7897'}}:{})});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/?design=complete-20261024');
   const navigation=page.getByRole('navigation',{name:'主导航',exact:true});
   if(width<=700){
    const menu=page.getByRole('button',{name:'导航',exact:false});
    assert(await navigation.isHidden());await menu.click();
    for(const name of ['产品','版本对比','文档','开发者','下载'])assert(await navigation.getByRole('link',{name,exact:name!=='下载'}).isVisible());
    await page.screenshot({path:`test-results/portal-menu-${width}.png`});await navigation.getByRole('link',{name:'开发者',exact:true}).focus();await page.keyboard.press('Escape');
    assert(await navigation.isHidden());assert(await menu.evaluate(e=>e===document.activeElement));
    await menu.click();await navigation.getByRole('link',{name:'版本对比',exact:true}).click();
    assert(await navigation.isHidden());assert.equal(new URL(page.url()).hash,'#editions');assert.equal(await page.evaluate(()=>document.activeElement.id),'editions');
   }else assert(await navigation.getByRole('link',{name:'开发者',exact:true}).isVisible());
   for(const [system,label] of [['windows','Windows'],['macos','macOS'],['linux','Linux'],['android','Android']]){
    const platform=page.locator('[data-platform-jump="'+system+'"]');assert(await platform.isVisible());assert((await platform.textContent()).includes(label));
    await platform.click();assert.equal(await page.locator('[data-system="'+system+'"]').getAttribute('aria-selected'),'true');
    assert((await page.locator('[data-field="download"]').getAttribute('href')).startsWith('/downloads/pro/v'+version+'/'));
    const variants=page.locator('#download-variant option');
    for(const option of await variants.all()){const url=await option.getAttribute('value');assert(url.startsWith('/downloads/pro/v'+version+'/'));await page.locator('#download-variant').selectOption(url);assert.equal(await page.locator('[data-field="download"]').getAttribute('href'),url);}
   }
   await page.getByRole('tab',{name:'终端与文件',exact:true}).click();assert.match(await page.locator('#scene-image').getAttribute('src'),/linux-workspace/);
   await page.getByRole('tab',{name:'终端与文件',exact:true}).press('ArrowRight');assert.equal(await page.getByRole('tab',{name:'扩展与应用',exact:true}).getAttribute('aria-selected'),'true');
   await page.getByRole('tab',{name:'桌面与智能体',exact:true}).click();
   await page.locator('img[loading]').evaluateAll(images=>images.forEach(i=>i.loading='eager'));
   await page.evaluate(async()=>{await Promise.all([...document.images].map(i=>i.decode()))});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   assert.equal(await page.locator('main h1').count(),1);assert.equal(await page.locator('.machine-map').count(),0);
   await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
   await page.screenshot({path:`test-results/portal-complete-${live?'live-':''}${width}.png`,fullPage:width===1440});
  }
  await page.locator('#homepage-doc-search').fill('代理');await page.getByRole('button',{name:'搜索文档',exact:true}).click();await page.locator('.doc-search-results a').first().waitFor();assert.equal(await page.locator('#doc-search').inputValue(),'代理');
  await page.goto(origin+'/downloads.html');await page.getByRole('radio',{name:/CAgent/}).check();
  await page.getByRole('radio',{name:'Android',exact:true}).check();assert((await page.locator('body').innerText()).includes('独立'));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const noScript=await browser.newContext({javaScriptEnabled:false,viewport:{width:320,height:900}});
  try{const fallback=await noScript.newPage();await fallback.goto(origin+'/');for(const name of ['产品','版本对比','文档','开发者','下载'])assert(await fallback.getByRole('navigation',{name:'主导航',exact:true}).getByRole('link',{name,exact:name!=='下载'}).isVisible());}finally{await noScript.close();}
  assert.deepEqual(errors,[]);console.log('PASS: four platforms, accurate links, scenes/keyboard, 320/390/1440px, image decode, homepage search handoff, download empty state, no JS errors');
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
