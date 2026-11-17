type PackageState = {id:string; version:string; grants:string[]; status:string};
type ManagedPack = {
  entry:{id:string;version:string};
  status():{configured:boolean;running:boolean;validationUnknown:boolean;subscriptionAccountIssue?:boolean;settings?:{subscriptionEnabled:boolean}};
  listenerState?():Promise<string | undefined>;
  processes():Promise<unknown>;
};

export function wechatHealthTools(records:PackageState[], packs:ManagedPack[]) {
  return packs.filter(pack => records.some(record => record.id === pack.entry.id &&
    record.version === pack.entry.version && record.grants.includes('wechat.api'))).map(pack => ({
    packageId:pack.entry.id, id:'wechat_health', toolId:'wechat_health',
    description:'Read WeChat package binding and native validation readiness on this device.',
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    outputSchema:{type:'object',properties:{state:{type:'string'},running:{type:'boolean'},version:{type:'string'}}},
    permissions:['wechat.api'],sideEffect:false,
  }));
}

export async function readWechatHealth(records:PackageState[], packs:ManagedPack[], input:unknown, signal:AbortSignal) {
  const p = input as {packageId?:string;toolId?:string;args?:unknown};
  if (!p || p.toolId !== 'wechat_health') return undefined;
  const tool = wechatHealthTools(records,packs).find(tool => tool.packageId === p.packageId);
  if (!tool || !p.args || typeof p.args !== 'object' || Array.isArray(p.args) || Object.keys(p.args).length)
    throw Error('WeChat health tool unavailable or invalid arguments');
  signal.throwIfAborted();
  const pack = packs.find(pack => pack.entry.id === tool.packageId)!;
  const runtime = pack.status();
  let state = 'configuration_pending';
  if (runtime.validationUnknown) state = 'validation_unknown';
  else if (runtime.subscriptionAccountIssue) state = 'subscription_account_required';
  else if (runtime.configured) {
    try {
      const native = await pack.processes() as {bound?:boolean;locked?:boolean;validation?:{valid?:boolean}};
      if (native.locked === true) state = 'locked';
      else if (native.bound !== true) state = 'binding_pending';
      else if (native.validation?.valid !== true) state = 'validation_pending';
      else if (!runtime.running) state = 'service_stopped';
      else if (runtime.settings?.subscriptionEnabled && records.some(r => r.id === pack.entry.id && r.grants.includes('wechat.events.read'))) {
        const listener = await pack.listenerState?.();
        state = listener === 'listening' ? 'ready' : listener === 'cleanup-unconfirmed' ? 'listener_cleanup_unknown' :
          listener === 'starting' ? 'listener_starting' : 'listener_unavailable';
      } else state = 'ready';
    } catch { state = 'diagnostic_unavailable'; }
  }
  signal.throwIfAborted();
  return {state,running:runtime.running,version:pack.entry.version};
}
