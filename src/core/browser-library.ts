import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {z} from 'zod';

export function browserUrl(value:string) {
  try {const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}
}
const url=z.string().max(8192).refine(browserUrl);
const entry=z.object({url,title:z.string().max(256),at:z.string()});
const tab=z.object({url:z.union([url,z.literal('about:blank')]),title:z.string().max(256),zoom:z.number().min(.5).max(2)});
export const browserLibrarySchema=z.object({tabs:z.array(tab).max(12),selected:z.number().int().min(0).max(11),history:z.array(entry).max(300),bookmarks:z.array(entry).max(200)});
export type BrowserLibraryData=z.infer<typeof browserLibrarySchema>;
export class BrowserLibrary {
  data:BrowserLibraryData;
  constructor(private path:string,private codec:{encrypt:(s:string)=>Buffer;decrypt:(b:Buffer)=>string}) {
    this.data=existsSync(path)?browserLibrarySchema.parse(JSON.parse(codec.decrypt(readFileSync(path)))):{tabs:[],selected:0,history:[],bookmarks:[]};
  }
  save() {
    const bytes=this.codec.encrypt(JSON.stringify(browserLibrarySchema.parse(this.data)));
    mkdirSync(dirname(this.path),{recursive:true});
    writeFileSync(this.path+'.tmp',bytes,{mode:0o600});renameSync(this.path+'.tmp',this.path);
  }
  visit(url:string,title:string) {
    if(!browserUrl(url))return;
    this.data.history=[{url,title:title.slice(0,256),at:new Date().toISOString()},...this.data.history.filter(e=>e.url!==url)].slice(0,300);
  }
  bookmark(url:string,title:string) {
    if(!browserUrl(url))throw Error('只能收藏 HTTP/HTTPS 网页');
    const existing=this.data.bookmarks.some(e=>e.url===url);
    if(!existing&&this.data.bookmarks.length>=200)throw Error('收藏夹最多保存 200 项');
    this.data.bookmarks=existing?this.data.bookmarks.filter(e=>e.url!==url):[{url,title:title.slice(0,256),at:new Date().toISOString()},...this.data.bookmarks];
    this.save();
  }
}
