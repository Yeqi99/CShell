import {readFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {mkdir,readFile,writeFile,rename,copyFile,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {constants} from 'node:fs';
import {z} from 'zod';

const owner=z.union([z.literal('guest'),z.string().regex(/^[a-f0-9]{32}$/)]);
const stateSchema=z.object({version:z.literal(1),legacy:owner,active:owner}).strict();
type State=z.infer<typeof stateSchema>;
export class AccountWorkspaceMismatch extends Error {
 constructor(){super('登录状态与本机工作区不一致，已停止云同步');this.name='AccountWorkspaceMismatch';}
}
/** The legacy workspace stays in place. Every subsequent account gets a full Electron profile. */
export class DesktopAccountProfiles {
  private state?:State;
  constructor(readonly root:string){
    try{this.state=stateSchema.parse(JSON.parse(readFileSync(join(root,'account-profile.json'),'utf8')));}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('账号工作区索引无法读取，原数据已保留');}
  }
  current(){return this.state?.active;}
  bootDirectory(){
    const directory=this.directory();
    if(directory!==this.root){
      mkdirSync(directory,{recursive:true});
      // Chromium may first flush its OS-protected key when the prior process exits.
      // Complete this copy before Electron initializes the next profile's key.
      try{copyFileSync(join(this.root,'Local State'),join(directory,'Local State'),constants.COPYFILE_EXCL);}
      catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw Error('账号工作区加密上下文未就绪，原数据已保留');}
    }
    return directory;
  }
  directory(id=this.state?.active){
    if(id===undefined)return this.root;
    owner.parse(id);
    return id===this.state?.legacy?this.root:join(this.root,'account-profiles',id);
  }
  private async persist(next:State){
    await mkdir(this.root,{recursive:true});
    const path=join(this.root,'account-profile.json');
    await writeFile(path+'.tmp',JSON.stringify(next),{mode:0o600});await rename(path+'.tmp',path);this.state=next;
  }
  async initialize(accountId?:string){
    const id=owner.parse(accountId??'guest');
    if(!this.state)await this.persist({version:1,legacy:id,active:id});
    else if(this.state.active!==id)throw new AccountWorkspaceMismatch();
  }
  async prepare(accountId?:string){
    if(!this.state)throw Error('账号工作区尚未初始化');
    const id=owner.parse(accountId??'guest'),directory=this.directory(id);
    await mkdir(directory,{recursive:true});
    const base=await realpath(this.root),target=await realpath(directory),rel=relative(base,target);
    if(rel.startsWith('..')||isAbsolute(rel))throw Error('账号工作区路径不安全');
    if(directory!==this.root){
      // Preserve the OS-protected Electron encryption context, never copy guest configuration.
      try{await copyFile(join(this.root,'Local State'),join(directory,'Local State'),constants.COPYFILE_EXCL);}
      catch(error){if(!['EEXIST','ENOENT'].includes((error as NodeJS.ErrnoException).code??''))throw error;}
    }
    return {directory,commit:async()=>{await this.persist({...this.state!,active:id});}};
  }
  async metadata(){return this.state?{...this.state}:undefined;}
  async localStatePresent(){try{await readFile(join(this.root,'Local State'));return true;}catch{return false;}}
}
