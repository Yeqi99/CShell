import {z} from 'zod';
import {createHash} from 'node:crypto';
import {preferencesSchema,type Preferences} from '../shared/contracts';
import type {ConnectionTool} from './connections/contracts';
const view=preferencesSchema.pick({layout:true,defaultConnectionView:true,workbenchView:true,locale:true,theme:true,uiFont:true,uiFontSize:true,sidebarFontSize:true,sidebarGroupSize:true,sidebarDetailSize:true,sidebarDensity:true,sidebarPingIntervalSeconds:true,terminalFont:true,fontSize:true,lineHeight:true,terminalClipboardKeys:true,terminalSemanticColors:true,backgroundOpacity:true,backgroundBlur:true,backgroundFit:true,showAiExecution:true});
const input=z.discriminatedUnion('action',[z.object({action:z.literal('read')}).strict(),z.object({action:z.literal('patch'),revision:z.string().regex(/^[a-f0-9]{64}$/),changes:view.partial().strict()}).strict()]);
export function preferencesTool(host:{read:()=>Preferences;save:(value:Preferences)=>Promise<void>}):ConnectionTool {
 let pending=Promise.resolve();
 const snapshot=()=>{const value=view.parse(Object.fromEntries(Object.keys(view.shape).map(key=>[key,(host.read() as any)[key]])));return {value,revision:createHash('sha256').update(JSON.stringify(value)).digest('hex')};};
 return {name:'application_preferences',capability:'preferences.manage',description:'Read or patch local appearance, layout, language, terminal and opening preferences. First read the revision, then patch explicit fields. No credentials, access grants, asset paths or network routing. Saves through normal application persistence.',input,needsReview:raw=>input.parse(raw).action==='patch',invoke:async(raw,signal,_out,guard)=>{
  const args=input.parse(raw);const check=()=>{signal.throwIfAborted();guard?.();};
  const work=pending.then(async()=>{check();const before=snapshot();if(args.action==='read')return JSON.stringify(before);if(before.revision!==args.revision)throw Error('Preferences changed; read again before patching');
   const next=preferencesSchema.parse({...host.read(),...args.changes,...(args.changes.defaultConnectionView?{defaultConnectionViewExplicit:true}:{})});check();await host.save(next);return JSON.stringify(snapshot());});
  pending=work.then(()=>{},()=>{});return work;
 }};
}
