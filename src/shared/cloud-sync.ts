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
export interface CloudBridge extends importAccountBridge {
  cloudDomains(input?:import('./member-domains').MemberDomainCommand):Promise<import('./member-domains').MemberDomainState>;
  cloudMcpClients(input?:{action:'create'|'revoke';id?:string;name?:string;bridgeId?:string;scopes?:string[]}):Promise<{endpoint?:string;bridges?:{id:string;name:string}[];clients?:{id:string;name:string;bridgeId:string;expiresAt:number;revoked:boolean}[];token?:string}>;
  cloudDiscovery(enabled?:boolean):Promise<AccountDiscoveryStatus>;
  cloudNetwork(input?:{source:string;target:string|null}):Promise<{mode:'applications';routes:{source:string;target:string}[];devices:{id:string;name:string}[]}>;
  cloudLending(input:{action:'list'|'create'|'redeem'|'revoke';body?:Record<string,unknown>}):Promise<{devices?:{id:string;name:string}[];loans?:{id:string;owned:boolean;accepted?:boolean;deviceIds:string[];email?:string;expiresAt:number;maxUses:number;revoked:boolean;uses:number}[];shareCode?:string;id?:string}>;
  cloudMemory():Promise<import('./account-memory').AccountHabit[]>;
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
