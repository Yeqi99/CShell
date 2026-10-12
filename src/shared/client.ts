import { z } from 'zod';
export const clientShellSchema = z.enum(['cmd', 'powershell']);
export type ClientShell = z.infer<typeof clientShellSchema>;
export const clientEndpointSchema = z
  .object({
    host: z
      .string()
      .min(1)
      .max(253)
      .regex(/^[a-zA-Z0-9.:-]+$/),
    port: z.number().int().min(1024).max(65535),
  })
  .strict();
export const clientInvitationSchema = clientEndpointSchema
  .extend({
    protocol: z.literal(1),
    deviceId: z.string().uuid(),
    name: z.string().min(1).max(80),
    certificate: z.string().min(100).max(8192),
    token: z.string().regex(/^[a-f0-9]{64}$/),
    expires: z.number().int().positive(),
  })
  .strict();
export type ClientInvitation = z.infer<typeof clientInvitationSchema>;
export type ClientDevice = Omit<ClientInvitation, 'token' | 'expires' | 'certificate'> & {
  fingerprint: string;
};
export type ClientStatus = {
  passwordConfigured?: boolean;
  allowedShells?: ClientShell[];
  interfaces?: string[];
  running: boolean;
  deviceId: string;
  fingerprint: string;
  port?: number;
  bind?: string;
  peers: { fingerprint: string; name: string; shells: ClientShell[]; connected: number }[];
  audit: { time: string; action: string; peer: string }[];
};
export interface ClientBridge {
  clientSetAccess(options: { password: string; shells: ClientShell[] }): Promise<ClientStatus>;
  clientConnectionInfo(host: string): Promise<string>;
  clientProbe(endpoint: { host: string; port: number }): Promise<ClientInfo>;
  clientPasswordPair(info: ClientInfo, password: string): Promise<ClientDevice>;
  openRdp(endpoint: { host: string; port: number }): Promise<void>;
  clientDownloadPage(): Promise<void>;
  clientTheme(theme: 'light' | 'dark'): Promise<void>;
  clientDevices(): Promise<ClientDevice[]>;
  clientPair(invitation: string): Promise<ClientDevice>;
  clientForget(deviceId: string): Promise<void>;
  clientConnect(deviceId: string, shell: ClientShell): Promise<{ sessionId: string; name: string }>;
  clientStatus(): Promise<ClientStatus>;
  clientStart(options: { bind: string; port: number }): Promise<ClientStatus>;
  clientStop(): Promise<ClientStatus>;
  clientInvite(options: { host: string; shells: ClientShell[] }): Promise<string>;
  clientRevoke(fingerprint: string): Promise<ClientStatus>;
}

export const clientPasswordSchema = z.string().min(12).max(128);
export const clientAccessSchema = z
  .object({ password: clientPasswordSchema, shells: z.array(clientShellSchema).min(1).max(2) })
  .strict();
export const clientInfoSchema = clientInvitationSchema.omit({ token: true, expires: true });
export type ClientInfo = z.infer<typeof clientInfoSchema>;
