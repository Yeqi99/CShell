import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
export class UpdateReceipt {
 private value:Record<string,unknown>|undefined;
 constructor(private directory:string,private current:string){}
 async load(){try{this.value=JSON.parse(await readFile(join(this.directory,'update-receipt.json'),'utf8'));}catch{}return this.status();}
 status(){return this.value?{...this.value,observedVersion:this.current,verified:this.value.targetVersion===this.current}:undefined;}
 async save(value:Record<string,unknown>){await mkdir(this.directory,{recursive:true});const file=join(this.directory,'update-receipt.json');await writeFile(file+'.tmp',JSON.stringify(value),{mode:0o600});await rename(file+'.tmp',file);this.value=value;}
}
