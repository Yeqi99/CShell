import { build } from 'esbuild';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const legacy = process.argv.includes('--legacy');
const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
import {scheduleTerminalActivation} from './src/ui/terminal-activation';
const callbacks=new Map();let next=0;let active=true;let fitted=0;
const frames={request:(callback)=>{callbacks.set(++next,callback);return next},cancel:(id)=>callbacks.delete(id)};
const old=(actions,frames)=>{frames.request(()=>{actions.fit();actions.focus()});return ()=>{}};
window.fixture={activate(){active=true;return (${legacy ? 'old' : 'scheduleTerminalActivation'})({active:()=>active,fit:()=>fitted++,focus:()=>document.querySelector('#terminal').focus()},frames)},flush(){const pending=[...callbacks.values()];callbacks.clear();for(const callback of pending)callback()},deactivate(){active=false},fitted:()=>fitted};
` }, bundle: true, write: false, format: 'iife' });
const browser = await chromium.launch({channel:'msedge'});
try {
  const page=await browser.newPage();
  await page.setContent('<button id="tab">Terminal tab</button><textarea id="terminal"></textarea><input id="search" placeholder="Search"><input id="other" placeholder="Other page">');
  await page.addScriptTag({content:result.outputFiles[0].text});
  await page.locator('#tab').focus();
  await page.evaluate(()=>{(window as any).cleanup=(window as any).fixture.activate()});
  await page.locator('#search').fill('history-marker');
  await page.evaluate(()=>(window as any).fixture.flush());
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'search','queued activation stole newly opened search focus');
  await page.locator('#tab').focus();
  const before=await page.evaluate(()=>{(window as any).cleanup=(window as any).fixture.activate();return (window as any).fixture.fitted()});
  await page.locator('#other').fill('retained draft');
  await page.evaluate(()=>{(window as any).fixture.deactivate();(window as any).cleanup();(window as any).fixture.flush()});
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'other');
  assert.equal(await page.evaluate(()=>(window as any).fixture.fitted()),before,'inactive terminal was resized');
  await page.locator('#tab').focus();
  await page.evaluate(()=>{(window as any).fixture.activate();(window as any).fixture.flush()});
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'terminal','normal activation must still focus terminal');
  console.log('PASS real browser focus: delayed activation preserves search/other-page intent; invalidated frame does not fit; normal terminal focuses');
} finally { await browser.close(); }
