/** Host contract for optional model-provider extensions. Secrets and transport stay backend-only. */
export type AiExtensionRef = { id: string; model: string };
export type AiRuntimeProvider = { id?:string; name?:string; url:string; model:string; key:string; transport?:typeof fetch };
export interface AiProviderExtension {
  id:string;
  call(action:string,input:unknown):Promise<unknown>;
  resolve(model:string,session:string):Promise<AiRuntimeProvider>;
}
export class AiExtensionRegistry {
  private entries=new Map<string,AiProviderExtension>();
  register(extension:AiProviderExtension){if(this.entries.has(extension.id))throw Error('Duplicate AI extension');this.entries.set(extension.id,extension);}
  private get(id:string){const e=this.entries.get(id);if(!e)throw Error('模型扩展不可用，请安装并启用对应扩展');return e;}
  call(id:string,action:string,input:unknown){return this.get(id).call(action,input);}
  resolve(ref:AiExtensionRef,session:string){return this.get(ref.id).resolve(ref.model,session);}
}
