import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

// Exercise the actual pinned xterm DOM renderer. Private renderer dimensions are
// read only in this fixture; product code uses no xterm private members.
const directory = await mkdtemp(join(tmpdir(), 'cshell-terminal-measurement-'));
await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
import {Terminal} from '@xterm/xterm';
import {Unicode11Addon} from '@xterm/addon-unicode11';
import {isolateTerminalMeasurement} from './src/ui/terminal-measurement';
import '@xterm/xterm/css/xterm.css';
const profile={reads:0,zero:0};
const width=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'offsetWidth');
Object.defineProperty(HTMLElement.prototype,'offsetWidth',{...width,get(){
  const value=width.get.call(this);
  if(this.classList.contains('xterm-char-measure-element')&&this.parentElement?.classList.contains('xterm-width-cache-measure-container')){
    profile.reads++;if(value===0)profile.zero++;
  }
  return value;
}});
const host=document.getElementById('host');
// A session can be created before its visual terminal window has been opened.
host.style.display='none';
const terminal=new Terminal({cols:100,rows:12,scrollback:64,allowProposedApi:true});
terminal.loadAddon(new Unicode11Addon());terminal.unicode.activeVersion='11';
terminal.open(host);
const textarea=terminal.textarea;
const cleanup=isolateTerminalMeasurement(terminal.element);
const preferences=(size)=>{
 terminal.options.fontFamily='Consolas, monospace';
 terminal.options.fontSize=size;
 terminal.options.lineHeight=1.2;
 // Same initialization order as TerminalPane's preferences effect.
 terminal.options.theme={background:'#fff',foreground:'#24334a'};
};
preferences(16);
window.fixture={
 profile,
 write:text=>new Promise(resolve=>terminal.write(text,resolve)),
 show:visible=>{host.style.display=visible?'block':'none';if(visible)terminal.refresh(0,terminal.rows-1)},
 preferences,
 resize:(cols,rows)=>terminal.resize(cols,rows),
 selection:async()=>{terminal.select(0,terminal.buffer.active.baseY,20);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))},
 summary:()=>({
  measureHostCount:document.querySelectorAll('[data-cshell-terminal-measurement]').length,
  measureHostInBody:document.querySelector('[data-cshell-terminal-measurement]')?.parentNode===document.body,
  measureWidth:document.querySelector('.xterm-width-cache-measure-container span')?.offsetWidth,
  fontSize:document.querySelector('.xterm-width-cache-measure-container')?.style.fontSize,
  spacing:Number.parseFloat(terminal.element.querySelector('.xterm-rows').style.letterSpacing),
  cellWidth:terminal._core._renderService.dimensions.css.cell.width,
  textareaUnchanged:terminal.textarea===textarea&&terminal.element.contains(textarea),
  hostHidden:host.style.display==='none',
  rows:terminal.rows,cols:terminal.cols,
  text:Array.from({length:terminal.buffer.active.length},(_,i)=>terminal.buffer.active.getLine(i).translateToString(true)).join('\\n'),
 }),
 cells:()=>{
   const b=terminal.buffer.active;
   for(let y=0;y<b.length;y++){
     const line=b.getLine(y);if(!line.translateToString(true).startsWith('红色 中文'))continue;
     return {red:line.getCell(0).getFgColor(),wide:line.getCell(0).getWidth(),continuation:line.getCell(1).getWidth(),emoji:line.getCell(10).getWidth(),combining:line.getCell(13).getChars()};
   }
 },
 dispose:()=>{cleanup();terminal.dispose()},
};
`},bundle:true,outfile:join(directory,'fixture.js')});
const browser=await chromium.launch({channel:'msedge'});
try {
  const script=await readFile(join(directory,'fixture.js'),'utf8');
  const css=await readFile(join(directory,'fixture.css'),'utf8');
  const errors:string[]=[];
  const createView=async()=>{
    const page=await browser.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.setContent('<div id="host" style="width:1100px;height:500px"></div>');
    await page.addStyleTag({content:css});await page.addScriptTag({content:script});
    return page;
  };
  const main=await createView();
  const initial=await main.evaluate(()=>(window as any).fixture.summary());
  assert(initial.hostHidden&&initial.measureHostInBody&&initial.textareaUnchanged);
  assert.equal(initial.measureHostCount,1);
  assert(initial.measureWidth>0&&initial.cellWidth>0);
  assert(Math.abs(initial.spacing)<1,'preferences must recalculate initial default spacing after hidden open');

  // Trim scrollback while display:none. Selection/blur renders bypass xterm's
  // usual visibility pause, but repeated glyphs should still hit its cache.
  const load=Array.from({length:120},(_,i)=>'row '+i+' abcdefghijklmnopqrstuvwxyz 0123456789 中文 😀\r\n').join('');
  const profile=await main.evaluate(async(load)=>{
    const f=(window as any).fixture;
    f.profile.reads=0;f.profile.zero=0;
    await f.write(load);await f.selection();const first={...f.profile};
    await f.write(load);await f.selection();await f.write(load);await f.selection();
    return {first,final:{...f.profile},summary:f.summary()};
  },load);
  assert.equal(profile.final.zero,0,'hidden width lookups must never return zero');
  assert(profile.first.reads>0,'fixture must exercise hidden selection/trim DOM rendering');
  assert(profile.final.reads<256,`glyph cache must bound DOM reads, got ${profile.final.reads}`);
  assert(profile.final.reads-profile.first.reads<32,'repeated output must reuse glyph widths after scrollback trim');
  assert(profile.summary.text.includes('row 119'));
  const marker='\r\n\x1b[31m红色\x1b[0m 中文 😀 e\u0301\r\nroot@host:~# ';
  await main.evaluate(async(text)=>{const f=(window as any).fixture;await f.write(text);f.show(true)},marker);
  await main.waitForFunction(()=>document.querySelector('.xterm-rows')?.textContent?.includes('红色'));
  assert.deepEqual(await main.evaluate(()=>(window as any).fixture.cells()),{red:1,wide:2,continuation:0,emoji:2,combining:'e\u0301'});
  await main.evaluate(()=>{const f=(window as any).fixture;f.preferences(22);f.resize(78,14)});
  const enlarged=await main.evaluate(()=>(window as any).fixture.summary());
  assert.equal(enlarged.fontSize,'22px');assert(enlarged.cellWidth>initial.cellWidth);
  assert(Math.abs(enlarged.spacing)<1);assert(enlarged.textareaUnchanged);
  assert.equal(enlarged.cols,78);assert.equal(enlarged.rows,14);

  // Independent renderer/document, as used by a floating window. Its helper
  // must not affect the primary view or survive closing that window.
  await main.evaluate(()=>(window as any).fixture.show(false));
  const floating=await createView();
  await floating.evaluate(async(text)=>{const f=(window as any).fixture;f.resize(60,9);await f.write(text);f.show(true)},marker);
  await floating.waitForFunction(()=>document.querySelector('.xterm-rows')?.textContent?.includes('红色'));
  assert.equal((await floating.evaluate(()=>(window as any).fixture.summary())).measureHostCount,1);
  await floating.evaluate(()=>(window as any).fixture.dispose());
  assert.equal(await floating.locator('[data-cshell-terminal-measurement],.xterm-width-cache-measure-container').count(),0);
  await floating.close();
  await main.evaluate(()=>(window as any).fixture.show(true));
  await main.waitForFunction(()=>document.querySelector('.xterm-rows')?.textContent?.includes('红色'));
  const restored=await main.evaluate(()=>(window as any).fixture.summary());
  assert.equal(restored.cols,78);assert.equal(restored.fontSize,'22px');assert(restored.textareaUnchanged);
  await main.evaluate(()=>(window as any).fixture.dispose());
  assert.equal(await main.locator('[data-cshell-terminal-measurement],.xterm-width-cache-measure-container').count(),0);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',hiddenMeasurementReads:profile.final.reads,hiddenZeroWidths:profile.final.zero,initialSpacing:initial.spacing,enlargedSpacing:enlarged.spacing}));
} finally {await browser.close();await rm(directory,{recursive:true,force:true});}
