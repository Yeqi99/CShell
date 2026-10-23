import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'permission-bulk-'));
await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AiPermissionTree}from'./src/ui/components/AiPermissionTree';import{emptyAiPolicy}from'./src/shared/ai';import './src/ui/styles.css';window.saved=[];window.cshell={aiPolicySave:async p=>window.saved.push(p)};createRoot(document.getElementById('root')).render(<AiPermissionTree visible snapshot={{policy:emptyAiPolicy()}} profiles={[{id:'a',name:'测试机器',host:'example.invalid',group:'测试'}]} groups={['测试']} refresh={async()=>{}}/>);`},bundle:true,jsx:'automatic',outfile:join(dir,'fixture.js')});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();
 await page.setContent('<html data-theme="light"><div id="root"></div></html>');
 await page.addStyleTag({content:await readFile(join(dir,'fixture.css'),'utf8')});
 await page.addScriptTag({content:await readFile(join(dir,'fixture.js'),'utf8')});
 await page.getByRole('button',{name:'全选',exact:true}).click();
 assert.equal(await page.getByRole('checkbox',{name:'允许访问 测试机器',exact:true}).isChecked(),true);
 assert.equal(await page.evaluate(()=>(window as any).saved.length),0);
 await page.getByRole('button',{name:'禁止此机器操作'}).click();
 await page.getByRole('button',{name:'清空应用权限'}).click();
 await page.getByRole('button',{name:'保存权限',exact:true}).click();
 await page.getByText('权限已保存',{exact:true}).waitFor();
 const policy=await page.evaluate(()=>(window as any).saved[0]);
 assert.deepEqual(policy.application,[]);assert.deepEqual(policy.profiles,['a']);assert.equal(policy.allMachines,false);assert.deepEqual(policy.overrides,[{profileId:'a',capabilities:[]}]);
 await page.getByRole('button',{name:'选择当前全部机器'}).click();
 await page.getByRole('button',{name:'清空机器范围'}).click();
 assert.equal(await page.getByRole('checkbox',{name:'允许访问 测试机器',exact:true}).isChecked(),false);
 assert.equal(await page.getByRole('button',{name:'全选此机器操作'}).isDisabled(),true);
 console.log('PASS: bulk selection remains a draft, explicit denial persists, clear scope disables machine actions');
}finally{await browser.close();}
