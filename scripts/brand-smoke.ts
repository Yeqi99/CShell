import {_electron as electron} from 'playwright';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const data=await mkdtemp(join(tmpdir(),'cshell-brand-'));
const version=JSON.parse(await readFile('package.json','utf8')).version;
const app=await electron.launch({args:process.env.CSHELL_EXECUTABLE?[]:['.'],...(process.env.CSHELL_EXECUTABLE?{executablePath:process.env.CSHELL_EXECUTABLE}:{}),env:{...process.env,CSHELL_TEST_DATA:data,CSHELL_TEST_START_GATE:"1"}});
try{assert.equal(await app.evaluate(({app})=>app.getVersion()),version);const page=await app.firstWindow();await page.waitForFunction(()=>document.querySelector<HTMLImageElement>('.brand-mark')?.naturalWidth===256);const mark=await page.locator('.brand-mark').getAttribute('src');assert.ok(mark);await page.screenshot({path:`test-results/brand-${version}-light.png`});await writeFile(`test-results/brand-ui-${version}.json`,JSON.stringify({version,loaded:true,mark}));}finally{await app.close();}
