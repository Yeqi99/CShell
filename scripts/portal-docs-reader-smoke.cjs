const {chromium}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');

// Read-only documentation review; PORTAL_ORIGIN optionally checks deployed assets.
(async()=>{
 const root=path.resolve('services/portal'),output=path.resolve('test-results/portal-docs-reader');await fs.mkdir(output,{recursive:true});
 const server=http.createServer(async(request,response)=>{
  try{const file=path.resolve(root,'.'+decodeURIComponent(new URL(request.url,'http://localhost').pathname));assert(file.startsWith(root+path.sep));const type={'.html':'text/html;charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';response.setHeader('Content-Type',type);response.end(await fs.readFile(file));}
  catch{response.writeHead(404).end('Not found');}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=process.env.PORTAL_ORIGIN||'http://127.0.0.1:'+server.address().port,owned=await chromium.launchServer({channel:process.platform==='win32'?'msedge':undefined}),browser=await chromium.connect(owned.wsEndpoint());
 try{
  const page=await browser.newPage(),errors=[],failures=[];page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)failures.push(response.url()+':'+response.status());});
  const pages=['connections','settings','desktop','automation','extensions','plugin-authoring','cagent','machine-info','developers'];
  const index=JSON.parse(await fs.readFile(path.join(root,'docs-index.json'),'utf8'));
  for(const item of index){const url=new URL(item.url,origin);assert.equal(url.origin,origin);const body=await fs.readFile(path.join(root,url.pathname),'utf8');assert(body.includes('id="'+decodeURIComponent(url.hash.slice(1))+'"'),'Missing search anchor: '+item.url);}
  for(const width of [320,390,900,1440]){
   await page.setViewportSize({width,height:940});
   for(const name of pages){
    const response=await page.goto(origin+'/docs/'+name+'.html');assert.equal(response.status(),200);await page.locator('.doc-toc').waitFor();
    assert.equal(await page.locator('h1').count(),1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' width '+width);
    assert(await page.locator('.doc-content').evaluate(element=>element.clientWidth>=Math.min(300,innerWidth-40)),name+' readable column width '+width);
    const headings=await page.locator('.doc-content h2[id]').allTextContents();assert.equal(await page.locator('.doc-toc a').count(),headings.length);assert.equal(await page.locator('.doc-toc').evaluate(element=>element.open),width>620);
    assert.equal(await page.locator('.doc-categories').evaluate(element=>element.open),width>620);
    if(name==='connections'||name==='plugin-authoring'||name==='developers')await page.screenshot({path:path.join(output,name+'-'+width+'.png')});
    const section=page.locator('.doc-content h2[id]').last();await section.scrollIntoViewIfNeeded();assert(await section.isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' lower section '+width);
   }
   await page.goto(origin+'/docs/connections.html');if(width<=620)await page.locator('.doc-toc summary').click();await page.locator('.doc-toc a[href="#file-protocols"]').click();await page.waitForFunction(()=>{const element=document.getElementById('file-protocols');return element===document.activeElement&&element.getBoundingClientRect().top>=0&&element.getBoundingClientRect().top<150});if(width<=620)assert.equal(await page.locator('.doc-toc').evaluate(element=>element.open),false);await page.keyboard.press('Control+k');assert.equal(await page.locator('#doc-search').evaluate(element=>element===document.activeElement),true);
   for(const [query,expected] of [['FTPS','file-protocols'],['默认打开','default-connection-view'],['独立进程',null],['全屏',null]]){
    await page.locator('#doc-search').fill(query);await page.locator('.doc-search-results a').first().waitFor();if(expected)assert(await page.locator('.doc-search-results a[href$="#'+expected+'"]').count()>0,'search '+query);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'search overflow '+width);
   }
   await page.locator('#doc-search').fill('FTPS');const result=page.locator('.doc-search-results a[href$="#file-protocols"]');await result.waitFor();await result.click();await page.locator('#file-protocols').waitFor();assert.equal(new URL(page.url()).hash,'#file-protocols');await page.waitForFunction(()=>{const element=document.getElementById('file-protocols');return element===document.activeElement&&element.getBoundingClientRect().top>=0&&element.getBoundingClientRect().top<150});assert(await page.locator('.doc-search-results').isHidden());await page.screenshot({path:path.join(output,'search-target-'+width+'.png')});
   await page.locator('#doc-search').fill('连接');await page.locator('.doc-search-results a').nth(1).waitFor();
   const links=page.locator('.doc-search-results a');await page.locator('#doc-search').press('ArrowDown');assert(await links.first().evaluate(e=>e===document.activeElement));
   await page.keyboard.press('ArrowDown');assert(await links.nth(1).evaluate(e=>e===document.activeElement));
   await page.keyboard.press('End');assert(await links.last().evaluate(e=>e===document.activeElement));
   await page.keyboard.press('Home');assert(await links.first().evaluate(e=>e===document.activeElement));
   await page.keyboard.press('ArrowUp');assert(await page.locator('#doc-search').evaluate(e=>e===document.activeElement));
   await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');assert(await page.locator('.doc-search-results').isHidden());assert(await page.locator('#doc-search').evaluate(e=>e===document.activeElement));
   await page.locator('#doc-search').fill('没有这个功能-xyz-9876');await page.getByText('没有找到，试试功能名称或更短的关键词。',{exact:true}).waitFor();await page.locator('#doc-search').press('Escape');assert(await page.locator('.doc-search-results').isHidden());
  }
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);console.log('PASS '+pages.length+' documentation pages × 320/390/900/1440: readable columns, no document overflow, mobile collapsed navigation, TOC; '+index.length+' search anchors, Ctrl+K, feature terms, result navigation, empty state, result Arrow/Home/End/Escape navigation; no JS/network errors');
 }finally{await owned.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
