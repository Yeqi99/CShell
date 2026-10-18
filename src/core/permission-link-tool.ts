import { z } from 'zod';
import { permissionNodes, permissionHref } from '../shared/permission-links';
import type { ConnectionTool } from './connections/contracts';

export const permissionLinkTool:ConnectionTool = {
 name:'get_permission_link',capability:'navigation.permissions',
 description:'Return a clickable permission settings link, or list supported permission nodes if node is omitted. Always available: navigation only, does not grant access, change settings or run blocked operations. When an operation lacks a permission, call this tool and include the returned markdown verbatim. For recent WeChat conversations use wechat/readSessions; application/wechat.read is a separate agent grant. Do not invent links or claim permission is enabled.',
 input:z.object({node:z.string().refine(id=>permissionNodes.some(n=>n.id===id),'Unknown permission node').optional()}).strict(),
 needsReview:()=>false,
 invoke:async(input,signal)=>{
  signal.throwIfAborted();const {node}=permissionLinkTool.input.parse(input) as {node?:string};
  if(!node)return JSON.stringify({nodes:permissionNodes});
  const n=permissionNodes.find(n=>n.id===node)!;
  return JSON.stringify({node,label:n.label,href:permissionHref(node),markdown:`[前往授权：${n.label}](${permissionHref(node)})`,changesPermissions:false,requiresUserSave:true});
 },
};
