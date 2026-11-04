/** Fixed official mirrors only; callers still verify exact platform, size and SHA256. */
const origin = 'https://shell.canp.ai';
const repository = 'https://github.com/Yeqi99/CShell/releases/download/';
export type UpdateFetch = (url: string) => Promise<Response>;
function locationFor(url: string) {
 const u = new URL(url);
 if(u.origin!==origin || u.search || u.hash || u.username || u.password)throw Error('Invalid update source');
 const m=/^\/downloads\/(opensource|pro)\/(releases\.json|v\d+\.\d+\.\d+\/[^/]+)$/.exec(u.pathname);
 if(!m)throw Error('Invalid update source');
 return {edition:m[1],path:m[2]};
}
function tagFor(edition:string, tag:string){return edition==='pro'?'pro-'+tag:tag;}
async function boundedJson(response:Response){
 if(!response.body)throw Error('Empty update catalog');
 const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>8*1024*1024)throw Error('Update catalog too large');chunks.push(r.value);}}finally{await reader.cancel();}
 const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
 return JSON.parse(new TextDecoder().decode(all));
}
export async function requestUpdateWithFallback(url:string, request:UpdateFetch):Promise<Response>{
 const location=locationFor(url);
 try{
  const response=await request(url);
  if(response.ok)return response;
  if(response.status<500 && response.status!==408 && response.status!==429)return response;
  await response.body?.cancel();
 }catch(error){if(error instanceof Error && error.name==='AbortError')throw error;}
 if(location.path==='releases.json'){
  const response=await request('https://api.github.com/repos/Yeqi99/CShell/releases?per_page=100');
  if(!response.ok)return response;
  const raw=await boundedJson(response);if(!Array.isArray(raw))throw Error('Invalid official release catalog');
  const pattern=location.edition==='pro'?/^pro-v\d+\.\d+\.\d+$/:/^v\d+\.\d+\.\d+$/;
  const releases=raw.filter(r=>r&&!r.draft&&!r.prerelease&&pattern.test(r.tag_name)&&Array.isArray(r.assets)).map(r=>{
   const tag=location.edition==='pro'?r.tag_name.slice(4):r.tag_name;
   return {...r,tag_name:tag,assets:r.assets.filter((a:any)=>typeof a.name==='string'&&/^[A-Za-z0-9_.-]+$/.test(a.name)&&a.browser_download_url===repository+r.tag_name+'/'+a.name).map((a:any)=>({...a,browser_download_url:origin+'/downloads/'+location.edition+'/'+tag+'/'+a.name}))};
  });
  return new Response(JSON.stringify(releases),{status:200,headers:{'Content-Type':'application/json'}});
 }
 const [tag,name]=location.path.split('/');
 if(!/^[A-Za-z0-9_.-]+$/.test(name))throw Error('Invalid update filename');
 let next=repository+tagFor(location.edition,tag)+'/'+name;
 for(let hop=0;hop<4;hop++){
  const response=await request(next);
  if(![301,302,303,307,308].includes(response.status))return response;
  const target=response.headers.get('location');await response.body?.cancel();
  if(!target)throw Error('Missing update redirect');
  const parsed=new URL(target,next);
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash||!['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(parsed.hostname))throw Error('Untrusted update redirect');
  next=parsed.href;
 }
 throw Error('Too many update redirects');
}
