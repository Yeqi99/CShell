const origin='https://shell.canp.ai';
function failure(status,text){return new Response(text,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
function rangeFor(value,size){if(!value)return null;const m=/^bytes=(\d*)-(\d*)$/.exec(value);if(!m||!m[1]&&!m[2])throw Error('range');let start,end;if(!m[1]){const suffix=Number(m[2]);if(!Number.isSafeInteger(suffix)||suffix<1)throw Error('range');start=Math.max(0,size-suffix);end=size-1;}else{start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),size-1):size-1;}if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)throw Error('range');return{start,end,header:`bytes=${start}-${end}`};}
export function createHandler(manifest,fetcher=fetch){return async function(request){
 const url=new URL(request.url);if(url.origin!==origin)return failure(404,'Not found');if(!['GET','HEAD'].includes(request.method))return failure(405,'GET or HEAD required');
 // Paths are literal and immutable: no URL forwarding, normalization aliases, or user-controlled origins.
 if(/%|\\/.test(url.pathname))return failure(404,'Not found');
 if(Object.hasOwn(manifest.catalogs,url.pathname))return new Response(request.method==='HEAD'?null:JSON.stringify(manifest.catalogs[url.pathname]),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=60','X-Content-Type-Options':'nosniff'}});
 const asset=Object.hasOwn(manifest.files,url.pathname)?manifest.files[url.pathname]:null;if(!asset)return failure(404,'Not found');
 let range;try{range=rangeFor(request.headers.get('Range'),asset.size)}catch{return new Response(null,{status:416,headers:{'Content-Range':`bytes */${asset.size}`,'Cache-Control':'no-store'}})}
 const headers=new Headers({'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${asset.name}"`,'Accept-Ranges':'bytes','ETag':'"'+asset.digest+'"','X-Checksum-Sha256':asset.digest.slice(7),'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=300'});
 headers.set('Content-Length',String(range?range.end-range.start+1:asset.size));if(range)headers.set('Content-Range',`bytes ${range.start}-${range.end}/${asset.size}`);
 if(request.method==='HEAD'){headers.set('X-CShell-Verification','pinned-metadata-only');return new Response(null,{status:range?206:200,headers});}
 try{
  let current=new URL(asset.url);if(current.protocol!=='https:'||current.hostname!=='github.com'||!current.pathname.startsWith('/Yeqi99/CShell/releases/download/'))throw Error('origin');
  let response;
  for(let redirects=0;redirects<4;redirects++){
   const forwarded={'User-Agent':'CShell-update-edge','Accept-Encoding':'identity'};if(range)forwarded.Range=range.header;
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);
   try{response=await fetcher(current.href,{method:'GET',headers:forwarded,redirect:'manual',signal:controller.signal})}finally{clearTimeout(timer)}
   if(![301,302,303,307,308].includes(response.status))break;
   const location=response.headers.get('Location');if(!location)throw Error('redirect');const next=new URL(location,current);
   if(next.protocol!=='https:'||next.hostname!=='release-assets.githubusercontent.com'||next.port||next.username||next.password)throw Error('redirect origin');
   await response.body?.cancel();current=next;response=null;
  }
  if(!response||response.status!==(range?206:200))throw Error('upstream status');
  if(response.headers.get('Content-Encoding')&&response.headers.get('Content-Encoding')!=='identity')throw Error('encoding');
  if(response.headers.get('Content-Length')!==headers.get('Content-Length'))throw Error('size');
  if(range&&response.headers.get('Content-Range')!==headers.get('Content-Range'))throw Error('range response');
  return new Response(response.body,{status:range?206:200,headers});
 }catch{return failure(502,'Download source unavailable; retry later')}
};}
