import {useState} from 'react';
import {groupIsCollapsed,readGroupExpansion} from './sidebar-groups';
export function useSidebarGroups(scope: string, preferred?: string) {
  const key=`cshell.sidebar.groups.v1:${scope}`;
  const [saved,setSaved]=useState<{key:string;value:Record<string,boolean>}>(()=>({key,value:read(key)}));
  const value=saved.key===key?saved.value:read(key);
  function read(storageKey:string){try{return readGroupExpansion(localStorage.getItem(storageKey));}catch{return {};}}
  function setCollapsed(id:string,collapsed:boolean){const next={...value,[id]:collapsed};setSaved({key,value:next});try{localStorage.setItem(key,JSON.stringify(next));}catch{/* Keep this window usable when storage is unavailable. */}}
  return {
    isCollapsed:(id:string)=>groupIsCollapsed(value,id,preferred),
    setCollapsed,
    toggle:(id:string)=>setCollapsed(id,!groupIsCollapsed(value,id,preferred)),
  };
}
