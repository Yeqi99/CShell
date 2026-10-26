import { z } from 'zod';
const label = z.string().trim().min(1).max(80).refine(v => !/[\u0000-\u001f\u007f]/.test(v));
export const lanRegistrationSchema = z.object({ enabled: z.boolean().default(false), name: label,
  room: z.string().trim().max(60).refine(v => !/[\u0000-\u001f\u007f]/.test(v)).default('') }).strict();
export type LanRegistration = z.infer<typeof lanRegistrationSchema>;
export const agentLanAnnouncementSchema = z.object({ protocol: z.literal('cshell-agent-lan-1'), deviceId: z.string().uuid(),
  name: label, room: lanRegistrationSchema.shape.room, port: z.number().int().min(1024).max(65535),
  fingerprint: z.string().regex(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/), version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/).max(60) }).strict();
export type AgentLanAnnouncement = z.infer<typeof agentLanAnnouncementSchema>;
export type AgentLanSource = Omit<AgentLanAnnouncement, 'protocol'> & { id: string; address: string; lastSeen: number };
export interface AgentLanStatus { enabled: boolean; advertising: boolean; sources: AgentLanSource[]; error: string | null }
export interface AgentLanPrepared { token: string; expiresAt: number; candidates: AgentLanSource[]; failures: { id: string; error: string }[] }
export interface AgentLanConfirm { token: string; confirmed: true; fingerprints: { id: string; fingerprint: string }[]; password: string }
export interface AgentLanEnrollmentResult { devices: import('./client').ClientDevice[]; failures: { id: string; error: string }[] }
export interface AgentLanBridge {
  status(): Promise<AgentLanStatus>;
  prepare(ids: string[]): Promise<AgentLanPrepared>;
  confirm(input: AgentLanConfirm): Promise<AgentLanEnrollmentResult>;
}
