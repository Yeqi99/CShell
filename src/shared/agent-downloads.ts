import {compareVersion} from './updates';
import {trustedDownload} from './download-source';
export interface AgentDownload {id:string;name:string;version:string;platform:string;arch:string;size:number;sha256:string;url:string}
export function agentDownloads(catalogs:unknown[]):AgentDownload[]{
 const selected=new Map<string,AgentDownload>();
 for(const catalog of catalogs){if(!Array.isArray(catalog))continue;for(const r of catalog){if(!r||r.draft||!/^v?\d+\.\d+\.\d+$/.test(r.tag_name)||!Array.isArray(r.assets))continue;for(const a of r.assets){
 const m=/^CAgent(?:-Setup)?-(\d+\.\d+\.\d+)-(win|mac|linux)-(x64|arm64)\.(exe|tar\.gz)$/.exec(a?.name||'');
 if(!m||m[1]!==r.tag_name.replace(/^v/,'')||!Number.isSafeInteger(a.size)||a.size<=0||a.size>1024*1024*1024||!/^sha256:[a-f0-9]{64}$/.test(a.digest||'')||!trustedDownload(a.browser_download_url))continue;
 const url=new URL(a.browser_download_url);if(decodeURIComponent(url.pathname.split('/').pop()||'')!==a.name||((m[2]==='win')!==(m[4]==='exe')))continue;
 const id=m[2]+'-'+m[3],next={id,name:a.name,version:m[1],platform:({win:'Windows',mac:'macOS',linux:'Linux'} as Record<string,string>)[m[2]],arch:m[3],size:a.size,sha256:a.digest.slice(7),url:a.browser_download_url};const old=selected.get(id);if(!old||compareVersion(next.version,old.version)>0)selected.set(id,next);
 }}}
 return [...selected.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
