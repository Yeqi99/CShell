import {basename,join,posix} from 'node:path';
import type {FtpService} from '../core/ftp';
import type {Transfers} from '../core/transfers';
import {childPath,safeName} from '../core/paths';

/** Native dialogs select local paths; FTP jobs share the existing bounded transfer queue. */
export function ftpTransfers(ftp:FtpService,transfers:Transfers){
  return {
    upload(id:string,sources:string[],directory:string){
      ftp.get(id);
      for(const source of sources){
        const name=basename(source),target=childPath(directory,name);
        transfers.enqueueOperation(id,name,async(state,signal,publish)=>{
          state.direction='upload';publish();
          await ftp.upload(id,source,target,signal,(done,total)=>{state.done=done;state.total=total;publish();});
        });
      }
    },
    download(id:string,sources:string[],directory:string){
      ftp.get(id);
      for(const source of sources){
        const name=safeName(posix.basename(source)),target=join(directory,name);
        transfers.enqueueOperation(id,name,async(state,signal,publish)=>{
          state.direction='download';publish();
          await ftp.download(id,source,target,signal,(done,total)=>{state.done=done;state.total=total;publish();});
        });
      }
    },
    async action(id:string,action:'mkdir'|'rename'|'delete',path:string,destination?:string){
      // The old IPC contract carries no file kind. Resolve it from the live parent listing.
      let directory:boolean|undefined;
      if(action==='delete'||action==='rename'){
        const listing=await ftp.list(id,posix.dirname(path));
        const entry=listing.entries.find(e=>e.name===posix.basename(path));
        if(!entry)throw new Error('文件已不存在，请刷新目录');
        directory=entry.directory;
      }
      return ftp.action(id,{action,path,destination,directory});
    },
  };
}
