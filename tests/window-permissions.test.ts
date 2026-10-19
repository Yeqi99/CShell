import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installWindowPermissions} from '../src/desktop/window-permissions';
test('fullscreen is limited to the trusted main document; other browser grants remain denied',()=>{
 let request:any,check:any;const entry='file:///app/index.html';const wc={getURL:()=>entry};
 installWindowPermissions({setPermissionRequestHandler:(f:any)=>request=f,setPermissionCheckHandler:(f:any)=>check=f} as any,wc as any,entry);
 const ask=(permission:string,contents:any=wc,url=entry,isMainFrame=true)=>{let result;request(contents,permission,(v:boolean)=>result=v,{requestingUrl:url,isMainFrame});return result;};
 assert.equal(ask('fullscreen'),true);assert.equal(check(wc,'fullscreen','file://',{requestingUrl:entry,isMainFrame:true}),true);
 assert.equal(ask('fullscreen',wc,entry,false),false);assert.equal(ask('fullscreen',{},entry),false);assert.equal(ask('fullscreen',wc,'https://example.test'),false);
 for(const p of ['media','notifications','clipboard-read','automatic-fullscreen'])assert.equal(ask(p),false);
 wc.getURL=()=> 'https://example.test';assert.equal(ask('fullscreen'),false);
});
