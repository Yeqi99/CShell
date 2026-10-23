import type {FileEntry} from '../shared/contracts';
/** A bounded read-only walk of an explicitly selected file root. Never follows symbolic links. */
export async function scanLargeFiles(list:(path:string)=>Promise<{entries:FileEntry[]}>,path:string,minimum:number,signal:AbortSignal){
 const queue=[path],seen=new Set<string>(),found:FileEntry[]=[];let entries=0,skipped=0;const started=Date.now();
 while(queue.length&&seen.size<200&&entries<10000&&Date.now()-started<20000){
  if(signal.aborted)break;const next=queue.shift()!;if(seen.has(next))continue;seen.add(next);
  let rows:FileEntry[];try{rows=(await list(next)).entries;}catch{if(signal.aborted)break;skipped++;continue;}
  if(signal.aborted)break;
  for(const row of rows){if(++entries>10000)break;if(row.symlink)continue;if(row.directory){if(queue.length<10000)queue.push(row.path);}else if(row.size>=minimum){found.push(row);found.sort((a,b)=>b.size-a.size);if(found.length>20)found.pop();}}
 }
 return {files:found,entries:Math.min(entries,10000),directories:seen.size,skipped,cancelled:signal.aborted,limited:queue.length>0||entries>=10000};
}
