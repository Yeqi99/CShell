import { useEffect,useState } from 'react';
import { parsePermissionHref } from '../shared/permission-links';
export const permissionEvent='cshell:permission-navigation';
let current:{node:NonNullable<ReturnType<typeof parsePermissionHref>>;serial:number}|null=null;
export function navigatePermission(href:string){
 const node=parsePermissionHref(href);if(!node)return false;
 current={node,serial:(current?.serial??0)+1};
 window.dispatchEvent(new Event(permissionEvent));return true;
}
export function usePermissionNavigation(){
 const [request,setRequest]=useState(current);
 useEffect(()=>{const update=()=>setRequest(current);window.addEventListener(permissionEvent,update);update();return()=>window.removeEventListener(permissionEvent,update);},[]);
 return request;
}
export function usePermissionFocus(page:'wechat'|'ai',ready=true){
 const request=usePermissionNavigation();
 useEffect(()=>{
  if(!ready||request?.node.page!==page)return;
  const frame=requestAnimationFrame(()=>{
   const node=Array.from(document.querySelectorAll<HTMLElement>('[data-permission-node]')).find(el=>el.dataset.permissionNode===request.node.id);
   if(!node||!node.getClientRects().length)return;
   document.querySelectorAll('.permission-location').forEach(el=>el.classList.remove('permission-location'));
   node.classList.add('permission-location');node.scrollIntoView({block:'center'});
   const input=node.querySelector<HTMLElement>('input:not(:disabled),textarea:not(:disabled),select:not(:disabled)');
   if(input)input.focus({preventScroll:true});else{node.tabIndex=-1;node.focus({preventScroll:true});}
  });return()=>cancelAnimationFrame(frame);
 },[request,page,ready]);
 return request;
}
