import {isIP} from 'node:net';
import {z} from 'zod';
const ip=z.string().refine(v=>isIP(v)!==0,'A resolved control-plane IP is required');
export const systemExitSchema=z.object({
 platform:z.enum(['win32','linux']),proxyPort:z.number().int().min(1).max(65535),
 dns:ip.default('1.1.1.1'),interfaceName:z.string().regex(/^cshell[0-9a-z]{0,8}$/).default('cshelltun'),
 controlAddresses:z.array(ip).min(1).max(32),
}).strict();
export type SystemExitInput=z.input<typeof systemExitSchema>;
/** No direct outbound exists. A separately installed persistent guard is mandatory. */
export function systemExitConfig(raw:SystemExitInput){const p=systemExitSchema.parse(raw);return {
 log:{level:'warn',timestamp:true},
 dns:{servers:[{type:'tcp',tag:'remote-dns',server:p.dns,server_port:53,detour:'machine'}],final:'remote-dns',strategy:'prefer_ipv4'},
 inbounds:[{type:'tun',tag:'system',interface_name:p.interfaceName,address:['198.18.0.1/30','fdfe:ca:6e::1/126'],mtu:1400,auto_route:true,strict_route:true,stack:'mixed',route_exclude_address:p.controlAddresses.map(a=>a+(isIP(a)===6?'/128':'/32'))}],
 outbounds:[{type:'http',tag:'machine',server:'127.0.0.1',server_port:p.proxyPort}],
 route:{rules:[{port:53,action:'hijack-dns'},{network:'udp',action:'reject'},{network:'tcp',action:'route',outbound:'machine'},{action:'reject'}],final:'machine',auto_detect_interface:true},
};}
export const linuxGuardSchema=z.object({interfaceName:z.string().regex(/^cshell[0-9a-z]{0,8}$/),controlUid:z.number().int().min(1),control:z.array(z.object({address:ip,port:z.number().int().min(1).max(65535)}).strict()).min(1).max(32)}).strict();
/** Dedicated service UID only; never exempt the interactive user's UID. No flush ruleset. */
export function linuxSystemExitGuard(raw:z.input<typeof linuxGuardSchema>){const p=linuxGuardSchema.parse(raw);return `table inet cshell_system_exit {
 chain output {
  type filter hook output priority 0; policy drop;
  oifname "lo" accept
  oifname "${p.interfaceName}" accept
  ${p.control.map(e=>`meta skuid ${p.controlUid} ${isIP(e.address)===6?'ip6':'ip'} daddr ${e.address} tcp dport ${e.port} accept`).join('\n  ')}
  udp sport 68 udp dport 67 accept
  udp sport 546 udp dport 547 accept
  icmpv6 type { nd-router-solicit, nd-router-advert, nd-neighbor-solicit, nd-neighbor-advert } accept
 }
}\n`;}
export interface SystemExitRuntime {
 /** Confirms no competing VPN, correct admin token, verified package and persistent guard support. */
 preflight():Promise<void>;
 authorize(plan:{tcp:true;dns:'remote-tcp';udp:'blocked';persistentGuard:true}):Promise<boolean>;
 guardInstall():Promise<void>;
 guardRemove():Promise<void>;
 engineStart(config:ReturnType<typeof systemExitConfig>):Promise<{ready():Promise<void>;stop():Promise<void>}>;
}
/** Guard intentionally survives engine crashes; only an explicit stop restores direct networking. */
export class SystemExitSession {
 private engine?:Awaited<ReturnType<SystemExitRuntime['engineStart']>>;
 private guarded=false;private busy=false;
 constructor(private runtime:SystemExitRuntime){}
 status(){return{guarded:this.guarded,running:!!this.engine};}
 async start(raw:SystemExitInput){if(this.busy||this.guarded)throw Error('SYSTEM_EXIT_ALREADY_SELECTED');const config=systemExitConfig(raw);this.busy=true;
 try{await this.runtime.preflight();if(!await this.runtime.authorize({tcp:true,dns:'remote-tcp',udp:'blocked',persistentGuard:true}))throw Error('SYSTEM_EXIT_NOT_AUTHORIZED');await this.runtime.guardInstall();this.guarded=true;this.engine=await this.runtime.engineStart(config);await this.engine.ready();return this.status();}
 catch(error){await this.engine?.stop().catch(()=>{});this.engine=undefined;throw error;}finally{this.busy=false;}}
 async stop(){if(this.busy)throw Error('SYSTEM_EXIT_BUSY');this.busy=true;try{await this.engine?.stop();this.engine=undefined;if(this.guarded){await this.runtime.guardRemove();this.guarded=false;}return this.status();}finally{this.busy=false;}}
}
