export type LocalClipboardContent = {kind:'text';text:string}|{kind:'png';data:string}|{kind:'files';files:{token:string;name:string;size:number}[]}|{kind:'empty'};
export interface LocalClipboardBridge {
 localClipboardRead():Promise<LocalClipboardContent>;
 localClipboardWrite(value:{kind:'text';text:string}|{kind:'png';data:string}):Promise<void>;
 localClipboardFileRead(token:string,offset:number,length:number):Promise<string>;
 localClipboardFilesBegin(files:{name:string;size:number}[]):Promise<string>;
 localClipboardFilesChunk(id:string,index:number,offset:number,data:string):Promise<void>;
 localClipboardFilesCommit(id:string):Promise<void>;
}
