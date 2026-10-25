import type {Client} from 'ssh2';

/** Consumers of a file-only connection cannot open exec, shell, network or
 * arbitrary subsystem channels. SFTP itself binds to the original transport so
 * ssh2's internal handshake stays intact; fluent lifecycle calls stay wrapped. */
export function sftpClientFacade(client:Client):Client {
 const forbidden=new Set(['exec','shell','subsys','forwardOut','forwardIn','unforwardIn','openssh_forwardOutStreamLocal','openssh_forwardInStreamLocal','openssh_unforwardInStreamLocal']);
 const methods=new Map<PropertyKey,unknown>();let facade:Client;
 facade=new Proxy(client,{get(target,key){
  if(methods.has(key))return methods.get(key);
  const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
  const wrapped=forbidden.has(String(key))? (...args:unknown[])=>{
   const error=new Error('SFTP 文件连接不提供终端、命令或网络转发能力，请使用 SSH 连接');
   const callback=args.at(-1);
   if(typeof callback==='function'){queueMicrotask(()=>callback(error));return facade;}
   throw error;
  }:(...args:unknown[])=>{const result=Reflect.apply(value,target,args);return result===target?facade:result;};
  methods.set(key,wrapped);return wrapped;
 }});
 return facade;
}
