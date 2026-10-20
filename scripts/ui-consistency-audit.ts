import {_electron as electron} from 'playwright';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const data=await mkdtemp(join(tmpdir(),'cshell-ui-audit-'));
const env={...process.env,CSHELL_TEST_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['.'],env});
const results:unknown[]=[];
try {
 const page=await app.firstWindow();page.setDefaultTimeout(15000);
 await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
 for(const theme of ['light','dark'])for(const width of [1440,900]){
  await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,850),width);
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.locator('.topbar button').last().click();
  const nav=page.locator('.settings-nav');
  const names=await nav.getByRole('button').allTextContents();
  for(const name of names){
   await nav.getByRole('button',{name,exact:true}).click();
   const content=page.locator('.settings-content');
   const fits=await content.evaluate(el=>el.scrollWidth<=el.clientWidth+2);
   results.push({section:'settings',name,theme,width,fits});assert.ok(fits,`${name} overflow ${width}`);
  }
  await page.screenshot({path:`test-results/ui-settings-${theme}-${width}.png`});
  await page.locator('.settings-savebar').getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'插件与应用',exact:true}).click();
  const market=page.locator('.extension-workbench:visible');await market.waitFor();
  const fits=await market.evaluate(el=>el.scrollWidth<=el.clientWidth+2);
  results.push({section:'extensions',theme,width,fits});assert.ok(fits,'market overflow');
  await page.screenshot({path:`test-results/ui-market-${theme}-${width}.png`});
 }
 await writeFile('test-results/ui-consistency-0.6.33.json',JSON.stringify({passed:true,isolated:true,results},null,2));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
