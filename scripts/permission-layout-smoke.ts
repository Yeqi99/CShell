import {_electron as electron} from 'playwright';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const data=await mkdtemp(join(tmpdir(),'cshell-permission-layout-'));
const env={...process.env,CSHELL_TEST_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['.'],env});
try {
 const page=await app.firstWindow();page.setDefaultTimeout(15000);
 await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
 await page.evaluate(async id=>window.cshell.aiProviderSave({id,name:'Layout fixture',url:'http://127.0.0.1:1/v1',model:'fixture'},''),randomUUID());
 await page.reload();await page.getByRole('button',{name:'AI 智能体',exact:true}).click();
 await page.getByRole('button',{name:'基座与权限',exact:true}).click();
 await page.getByRole('button',{name:'访问权限',exact:true}).click();
 await mkdir('test-results/permission-layout-020',{recursive:true});
 const measurements:unknown[]=[];
 for(const width of [360,500,700]){
  await page.locator('.ai-panel').evaluate((el,w)=>{(el as HTMLElement).style.width=w+'px';(el as HTMLElement).style.minWidth=w+'px';},width);
  const measured=await page.locator('.ai-panel').evaluate(el=>({cssWidth:el.getBoundingClientRect().width,dpr:window.devicePixelRatio}));
  assert(Math.abs(measured.cssWidth-width)<1,'requested CSS panel width must actually apply');
  const target=page.locator('[data-permission-node="application/connections.open"]');
  await target.evaluate(el=>el.classList.add('permission-location'));
  await target.locator('input').focus();await target.scrollIntoViewIfNeeded();
  const geometry=await page.locator('.permission-application-option').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,overflow:el.scrollWidth>el.clientWidth+1};}));
  for(let i=1;i<geometry.length;i++)assert(geometry[i].top>=geometry[i-1].bottom,'rows overlap');
  assert(geometry.every(x=>!x.overflow),'row horizontal overflow');
  const png=await page.locator('.ai-panel').screenshot({path:`test-results/permission-layout-020/${width}.png`});
  const pixelWidth=png.readUInt32BE(16);assert(Math.abs(pixelWidth-measured.cssWidth*measured.dpr)<=2,'screenshot DPI must match actual panel width');
  measurements.push({requestedCssWidth:width,...measured,pixelWidth});
 }
 await writeFile('test-results/permission-layout-020/geometry.json',JSON.stringify(measurements,null,2));
 const before=await page.evaluate(()=>window.cshell.aiSnapshot());
 await page.locator('[data-permission-node="application/connections.open"] input').check();
 assert.deepEqual((await page.evaluate(()=>window.cshell.aiSnapshot())).policy,before.policy,'draft must not save implicitly');
 await page.getByRole('button',{name:'保存权限',exact:true}).click();
 assert((await page.evaluate(()=>window.cshell.aiSnapshot())).policy.application.includes('connections.open'));
 console.log('PASS 360/500/700 permission rows: no overlap/overflow, focus, draft and explicit save');
}finally{await app.close();await rm(data,{recursive:true,force:true});}
