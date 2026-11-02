import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {Store} from './store';
import type {AccountDiscoveryStatus} from '../shared/cloud-sync';

type Device={deviceId:string;name:string;certificate:string;host:string;port:number;accountManaged?:boolean;accountPassword?:string};
type Listed={deviceId:string;certificate:string;online:boolean;borrowed?:boolean};
/** Account-scoped local preference. Never adds fields to older clients' strict cloud vault. */
export class AccountDiscovery {
  private account?:string;
  private value:AccountDiscoveryStatus={enabled:false,devices:[],pending:0};
  private serial:Promise<unknown>=Promise.resolve();
  constructor(private directory:string,private store:Store,private accountId:()=>string|undefined,
    private credentials:()=>Device[],private list:()=>Promise<Listed[]>,private publish:()=>void){}
  private path(id:string){return join(this.directory,'account-discovery-'+createHash('sha256').update(id).digest('hex')+'.json');}
  private exclusive<T>(fn:()=>Promise<T>):Promise<T>{const result=this.serial.then(fn);this.serial=result.catch(()=>{});return result;}
  private async load(){const id=this.accountId();if(id===this.account)return;this.account=id;this.value={enabled:false,devices:[],pending:0};if(!id)return;
    try{const data=JSON.parse(await readFile(this.path(id),'utf8'));if(this.accountId()!==id)return;this.value.enabled=data.enabled===true;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
  status():AccountDiscoveryStatus{return this.accountId()===this.account?structuredClone(this.value):{enabled:false,devices:[],pending:0};}
  get(){return this.exclusive(async()=>{await this.load();return this.status();});}
  set(enabled:boolean){return this.exclusive(async()=>{await this.load();const id=this.account;if(!id)throw Error('请先登录账号');
    const file=this.path(id);await writeFile(file+'.tmp',JSON.stringify({enabled}),{mode:0o600});
    if(this.accountId()!==id)throw Error('账号已切换，请重试');await rename(file+'.tmp',file);this.value.enabled=enabled;
    if(enabled)await this.refreshCurrent();return this.status();});}
  refresh(){return this.exclusive(async()=>{await this.load();await this.refreshCurrent();});}
  private async refreshCurrent(){const id=this.account;if(!id||!this.value.enabled)return;
    let rows:Listed[];try{rows=await this.list();}catch{this.value.devices=this.value.devices.map(d=>({...d,online:null}));this.publish();return;}
    if(id!==this.accountId())return;
    const known=this.credentials().filter(d=>d.accountManaged&&d.accountPassword);
    const own=rows.filter(d=>!d.borrowed);let pending=0;
    const devices:AccountDiscoveryStatus['devices']=[];
    for(const row of own){const device=known.find(d=>d.deviceId===row.deviceId&&d.certificate===row.certificate);
      if(!device){pending++;continue;}
      devices.push({id:device.deviceId,online:row.online===true});
      const existing=this.store.snapshot().profiles.find(p=>p.id===device.deviceId);
      // Never rewrite a user's name, group, ordering or protocol with discovery data.
      if(!existing&&this.accountId()===id)await this.store.saveProfile({id:device.deviceId,protocol:'client',name:device.name,host:device.host,port:device.port,username:'Client',group:'同账号设备',favorite:false,auth:'password',clientShell:'powershell'});
    }
    if(id!==this.accountId())return;
    // Missing/offline registry rows do not delete the user's connection or grouping.
    for(const device of known)if(!devices.some(d=>d.id===device.deviceId)&&this.store.snapshot().profiles.some(p=>p.id===device.deviceId))devices.push({id:device.deviceId,online:false});
    this.value={enabled:true,devices,pending};this.publish();
  }
}
