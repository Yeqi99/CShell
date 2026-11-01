import { z } from 'zod';
import { createHash } from 'node:crypto';
import { installedPluginSchema, type InstalledPlugin } from '../shared/plugins';

// Selection/configuration only. Executable payloads and local execution grants never travel here.
export const portablePluginSchema=installedPluginSchema.extend({manifestSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const portablePluginsSchema=z.array(portablePluginSchema).max(100);
export function portablePlugin(plugin:InstalledPlugin){return {...plugin,manifestSha256:createHash('sha256').update(JSON.stringify(plugin.manifest)).digest('hex')};}
export function restorePortablePlugins(local:InstalledPlugin[],incoming:z.infer<typeof portablePluginsSchema>):InstalledPlugin[]{
 const result=structuredClone(local);
 for(const item of incoming){
  if(portablePlugin(item).manifestSha256!==item.manifestSha256)throw Error('云端扩展清单摘要不匹配');
  const index=result.findIndex(p=>p.manifest.id===item.manifest.id);
  if(index>=0){const installed=result[index];if(installed.source===item.source&&portablePlugin(installed).manifestSha256===item.manifestSha256)result[index]={...installed,enabled:item.enabled};continue;}
  // Plain command snippets contain no code or install hooks. Permission checks still apply on use.
  if(item.manifest.provider==='snippets'&&!item.manifest.capability&&!item.manifest.id.startsWith('cshell.')&&item.manifest.permissions.every(p=>p==='terminal.input')){
   const {manifestSha256,...plugin}=item;result.push(plugin);
  }
 }
 return result;
}
