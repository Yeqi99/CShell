import { z } from 'zod';
import { createHash } from 'node:crypto';
import { readFile,writeFile,rename,mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { desktopLookSchema,desktopLookId,defaultDesktopLook,type DesktopLook } from '../shared/desktop-look';
import type { Store } from './store';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const ref=desktopLookSchema.omit({image:true}).extend({imageId:hash.optional()}).strict();
const schema=z.object({looks:z.record(desktopLookId,ref.nullable()),images:z.record(hash,desktopLookSchema.shape.image.unwrap())}).strict().superRefine((v,c)=>{
 if(Object.keys(v.looks).length>1000||JSON.stringify(v).length>8*1024*1024)c.addIssue({code:'custom',message:'桌面外观超过同步容量限制'});
});
type Data=z.infer<typeof schema>;
function referenced(data:Data):Data{const ids=new Set(Object.values(data.looks).flatMap(v=>v?.imageId?[v.imageId]:[]));return {looks:data.looks,images:Object.fromEntries(Object.entries(data.images).filter(([id])=>ids.has(id)))};}
function imageHash(uri:string){
 const [prefix,encoded]=uri.split(',');const b=Buffer.from(encoded,'base64');
 if(b.toString('base64')!==encoded)throw Error('桌面图片编码无效');
 const valid=prefix==='data:image/png;base64'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):prefix==='data:image/jpeg;base64'?b[0]===255&&b[1]===216&&b[2]===255:prefix==='data:image/webp;base64'&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';
 if(!valid||b.length<12)throw Error('桌面图片格式无效');
 return createHash('sha256').update(b).digest('hex');
}
export class DesktopLooks {
 private data:Data={looks:{},images:{}};private queue:Promise<unknown>=Promise.resolve();
 constructor(private directory:string,private codec:Pick<Store,'encryptPrivate'|'decryptPrivate'>,private changed:()=>void=()=>{}){}
 async load(){try{this.data=this.cloudValidate(JSON.parse(await this.codec.decryptPrivate(await readFile(join(this.directory,'desktop-looks.enc'),'utf8'))));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 cloudValidate(input:unknown){const v=schema.parse(input);for(const [id,image]of Object.entries(v.images))if(imageHash(image)!==id)throw Error('桌面图片摘要不一致');for(const look of Object.values(v.looks))if(look?.imageId&&!v.images[look.imageId])throw Error('桌面背景图片缺失');return referenced(v);}
 async cloudExport(){await this.queue.catch(()=>{});return Object.keys(this.data.looks).length?structuredClone(this.data):undefined;}
 private mutate(fn:()=>Data){const next=this.queue.catch(()=>{}).then(async()=>{const value=this.cloudValidate(referenced(fn()));await mkdir(this.directory,{recursive:true});const p=join(this.directory,'desktop-looks.enc');await writeFile(p+'.tmp',await this.codec.encryptPrivate(JSON.stringify(value)),{mode:0o600});await rename(p+'.tmp',p);this.data=value;this.changed();});this.queue=next;return next;}
 async cloudImport(input:unknown,rollback=false){if(input===undefined&&!rollback)return;const value=input===undefined?{looks:{},images:{}}:this.cloudValidate(input);await this.mutate(()=>value);}
 private value(id:string):DesktopLook|null|undefined{const look=this.data.looks[id];if(!look)return look;const {imageId,...rest}=look;return {...rest,...(imageId?{image:this.data.images[imageId]}:{})};}
 async get(input:unknown,legacy?:unknown){const id=desktopLookId.parse(input);await this.queue.catch(()=>{});
  if(!Object.hasOwn(this.data.looks,id)&&legacy!==undefined){const old=desktopLookSchema.parse(legacy);if(JSON.stringify(old)!==JSON.stringify(defaultDesktopLook))await this.save(id,old,true);}
  return this.value(id)??null;
 }
 async save(input:unknown,value:unknown,onlyMissing=false){const id=desktopLookId.parse(input),look=value===null?null:desktopLookSchema.parse(value);
  await this.mutate(()=>{if(onlyMissing&&Object.hasOwn(this.data.looks,id))return this.data;const next=structuredClone(this.data);if(look){const {image,...rest}=look;const imageId=image?imageHash(image):undefined;if(imageId)next.images[imageId]=image!;next.looks[id]={...rest,...(imageId?{imageId}:{})};}else next.looks[id]=null;return next;});return this.value(id)??null;
 }
}
