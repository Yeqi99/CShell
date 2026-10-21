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
  email?: string;
  unlocked: boolean;
  revision: number;
  lastSync?: string;
  state: 'signed-out' | 'locked' | 'ready' | 'syncing' | 'conflict' | 'error';
  error?: string;
}
export interface CloudBridge {
  onCloudChanged(listener: () => void): () => void;
  cloudStatus(): Promise<CloudStatus>;
  cloudRequestCode(email: string): Promise<void>;
  cloudLogin(email: string, code: string): Promise<CloudStatus>;
  cloudUnlock(recoveryKey: string): Promise<CloudStatus>;
  cloudCreateVault(): Promise<{ recoveryKey: string }>;
  cloudSync(direction?: 'upload' | 'download'): Promise<CloudStatus>;
  cloudLogout(): Promise<void>;
}
