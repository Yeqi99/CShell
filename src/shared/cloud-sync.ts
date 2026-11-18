import type {AccountImportBridge as importAccountBridge} from './account-import';
/** Shared wire format. Server never receives the plaintext vault or recovery key. */
export interface CloudEnvelope {
  format: 1;
  nonce: string;
  ciphertext: string;
}
export interface CloudSession {
  accountId: string;
  email: string;
  token: string;
}
export interface CloudRevision {
  revision: number;
  envelope: CloudEnvelope | null;
}
export interface CloudStatus {
  workspaceRecovered?:boolean;
  storage?:{usedBytes:number;limitBytes:number};
  membership?: { active: boolean; expiresAt: number | null };
  email?: string;
  unlocked: boolean;
  revision: number;
  lastSync?: string;
  state: 'signed-out' | 'locked' | 'ready' | 'syncing' | 'conflict' | 'error';
  error?: string;
}
export interface AccountDiscoveryStatus {enabled:boolean;devices:{id:string;online:boolean|null}[];pending:number}
export interface RentalCatalog {
  balance:number;
  memberPlans?:{id:string;name:string}[];
  quote?:{points:number;expires:number};
  plans:{id:string;name:string;system:string;cpu:number;memory:number;disk:number;points:number;days:number;included:boolean;dedicatedIp?:boolean;portCount?:number}[];
  machines:{id:string;name:string;included:boolean;state:string;expires:number|null;disk:number;updating:boolean;ports?:{host:string;port:number}[];portCount?:number}[];
}
export interface CloudBridge extends importAccountBridge {
  cloudAgentSpending(enabled?:boolean):Promise<{enabled:boolean}>;
  cloudConversations:import('./cloud-conversations').ChatBridge;
  cloudRentalSample(id:string,container:boolean):Promise<import('../desktop/rental-sample').RentalSample|null>;
  cloudRentalDeviceIds():Promise<string[]>;
  cloudRentals(input:{action:'list'|'order'|'connect'|'change'|'ports';id?:string;plan?:string;included?:boolean;request?:string;points?:number;days?:number;kind?:'expand'|'cpu'|'memory'|'port'|'renew';quote?:boolean;maxPoints?:number;units?:number}):Promise<RentalCatalog>;
  cloudMembershipMarket(email:string):Promise<{plans:{plan:string;relativeQuota:number;storageMiB:number;machine:string|null;price:number|null;days:number|null}[]}>;
  cloudBuyPlan(email:string,offer:{plan:string;price:number;days:number;request:string}):Promise<{expires:number}>;
  cloudPurchasePro(email:string,requestId:string):Promise<{expiresAt:number;balancePoints:number}>;
  cloudInvitePoster(email:string):Promise<string>;
  cloudRedeemGift(email:string,code:string):Promise<{kind:string;quantity:number;plan:string}>;
  cloudRefill(quote:string,request:string):Promise<unknown>;
  cloudTraffic():Promise<import('./account-traffic').AccountTraffic>;
  cloudDomains(input?:import('./member-domains').MemberDomainCommand):Promise<import('./member-domains').MemberDomainState>;
  cloudMcpClients(input?:{action:'create'|'revoke';id?:string;name?:string;bridgeId?:string;scopes?:string[]}):Promise<{endpoint?:string;bridges?:{id:string;name:string}[];clients?:{id:string;name:string;bridgeId:string;expiresAt:number;revoked:boolean}[];token?:string}>;
  cloudDiscovery(enabled?:boolean):Promise<AccountDiscoveryStatus>;
  cloudNetwork(input?:{source:string;target:string|null}):Promise<{mode:'applications';routes:{source:string;target:string}[];devices:{id:string;name:string}[]}>;
  cloudLending(input:{action:'list'|'create'|'redeem'|'revoke';body?:Record<string,unknown>}):Promise<{devices?:{id:string;name:string}[];loans?:{id:string;owned:boolean;accepted?:boolean;deviceIds:string[];email?:string;expiresAt:number;maxUses:number;revoked:boolean;uses:number}[];shareCode?:string;id?:string}>;
  cloudMemory():Promise<import('./account-memory').AccountHabit[]>;
  cloudOpenMemoryFile():Promise<void>;
  cloudRemember(input:{id?:string;text:string}):Promise<import('./account-memory').AccountHabit[]>;
  cloudForget(id:string):Promise<import('./account-memory').AccountHabit[]>;
  onCloudChanged(listener: () => void): () => void;
  cloudStatus(): Promise<CloudStatus>;
  cloudRequestCode(email: string): Promise<void>;
  cloudRegister(email:string,code:string,password:string): Promise<CloudStatus>;
  cloudLogin(email: string, code: string, password?: boolean): Promise<CloudStatus>;
  cloudUnlock(recoveryKey: string): Promise<CloudStatus>;
  cloudCreateVault(): Promise<{ recoveryKey: string }>;
  cloudSync(direction?: 'upload' | 'download'): Promise<CloudStatus>;
  cloudLogout(): Promise<void>;
}
