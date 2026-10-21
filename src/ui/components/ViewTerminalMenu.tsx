import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Terminal } from '@xterm/xterm';
import { analyzeSelection, openTextAssist } from '../text-assist';
import { useAiProviders } from '../use-ai-providers';
import { useI18n } from '../i18n';

export function ViewTerminalMenu({ host, terminal, sessionId, closed, onError }: {
  host: RefObject<HTMLDivElement | null>; terminal: RefObject<Terminal | null>; sessionId: string;
  closed: boolean; onError: (error: string) => void;
}) {
  const [menu, setMenu] = useState<{x: number; y: number; text: string} | null>(null);
  const available = useAiProviders().providers.length > 0;
  const {locale}=useI18n();const t=(zh:string,en:string)=>locale==='en-US'?en:zh;
  useEffect(() => {
    const node=host.current;if(!node||!sessionId)return;
    const context=(event: MouseEvent)=>{event.preventDefault();event.stopPropagation();setMenu({x:Math.max(4,Math.min(event.clientX,innerWidth-210)),y:Math.max(4,Math.min(event.clientY,innerHeight-180)),text:terminal.current?.getSelection()??''});};
    node.addEventListener('contextmenu',context);
    return ()=>node.removeEventListener('contextmenu',context);
  },[host,sessionId,terminal]);
  useEffect(()=>{
    if(!menu)return;
    const dismiss=(e: Event)=>{if(e.type==='keydown'&&(e as KeyboardEvent).key!=='Escape')return;if((e.target as Element)?.closest?.('.view-terminal-menu'))return;setMenu(null);};
    document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',dismiss);
    return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',dismiss);};
  },[menu]);
  if(!menu)return null;
  const read=()=>{const t=terminal.current;if(!t)return '';const b=t.buffer.active;return Array.from({length:Math.min(b.length,200)},(_,i)=>b.getLine(Math.max(0,b.length-200)+i)?.translateToString(true)??'').join('\n').trim();};
  const choose=(fn:()=>void)=>{setMenu(null);try{fn();}catch(e){onError(String(e));}};
  return createPortal(<div className="terminal-context view-terminal-menu" role="menu" style={{position:'fixed',left:menu.x,top:menu.y,zIndex:1000,minWidth:190}}>
    <button role="menuitem" disabled={!menu.text} onClick={()=>choose(()=>{void window.cshell.copyText(menu.text).catch(e=>onError(String(e)));})}>{t('复制选中文字','Copy selected text')}</button>
    <button role="menuitem" disabled={!available||!menu.text||closed} title={!available?t('请先在主窗口配置模型基座','Configure a model provider in the main window first'):''} onClick={()=>choose(()=>analyzeSelection(menu.text,sessionId))}>{t('AI 分析选中文字','Analyze selection with AI')}</button>
    <button role="menuitem" disabled={!available||closed} onClick={()=>choose(()=>{const text=read();if(!text)throw Error(t('终端暂无可分析的输出','No terminal output to analyze'));analyzeSelection(text,sessionId);})}>{t('AI 分析最近输出…','Analyze recent output…')}</button>
    <button role="menuitem" disabled={!available||!menu.text||closed} onClick={()=>choose(()=>openTextAssist({mode:'translate',text:menu.text,label:t('终端选中文字','Terminal selection'),sessionId}))}>{t('AI 翻译选中文字','Translate selected text')}</button>
    {closed&&<small style={{display:'block',padding:'6px 10px'}}>{t('会话已结束，请先重新连接','Session closed. Reconnect to use AI actions.')}</small>}
    {!available&&<small style={{display:'block',padding:'6px 10px'}}>{t('请先在主窗口配置模型基座','Configure a model provider in the main window first')}</small>}
  </div>,document.body);
}
