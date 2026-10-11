import { z } from 'zod';

export const toolsSettingsSchema = z
  .object({
    commandSuggestions: z.boolean().default(true),
    dockerEnabled: z.boolean().default(false),
    dockerSocket: z
      .string()
      .min(2)
      .max(255)
      .regex(/^\/(?:[^\0\r\n]+)$/)
      .default('/var/run/docker.sock'),
  })
  .strict();
export type ToolsSettings = z.infer<typeof toolsSettingsSchema>;
export const toolsDefaults: ToolsSettings = {
  commandSuggestions: true,
  dockerEnabled: false,
  dockerSocket: '/var/run/docker.sock',
};
export const dockerId = z.string().regex(/^(?:sha256:)?[a-f0-9]{12,64}$/);
export const portMappingSchema = z
  .object({
    host: z.union([z.ipv4(), z.ipv6()]).default('127.0.0.1'),
    hostPort: z.number().int().min(1).max(65535),
    containerPort: z.number().int().min(1).max(65535),
    protocol: z.enum(['tcp', 'udp']).default('tcp'),
  })
  .strict();
export type PortMapping = z.infer<typeof portMappingSchema>;
const ports = z
  .array(portMappingSchema)
  .max(100)
  .refine(
    (list) =>
      new Set(list.map((p) => `${p.host}:${p.hostPort}/${p.protocol}`)).size === list.length,
    'Duplicate host port',
  );
export const dockerActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.enum(['start', 'stop', 'restart', 'pause', 'unpause', 'remove', 'removeImage']),
      id: dockerId,
    })
    .strict(),
  z
    .object({
      type: z.literal('create'),
      image: dockerId,
      name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/),
      ports,
      restart: z.enum(['no', 'unless-stopped', 'always', 'on-failure']),
      start: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('ports'), id: dockerId, ports }).strict(),
]);
export type DockerAction = z.infer<typeof dockerActionSchema>;
export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  project: string;
}
export interface DockerImage {
  id: string;
  tags: string[];
  size: number;
  created: number;
}
export interface DockerSnapshot {
  containers: DockerContainer[];
  images: DockerImage[];
}
export interface DockerStats {
  cpu: number | null;
  memory: number;
  memoryLimit: number;
  rx: number;
  tx: number;
  pids: number | null;
}
export interface DockerDetails {
  ports: PortMapping[];
  restart: string;
  managed: boolean;
}
export interface DockerResult {
  id?: string;
  backup?: string;
  snapshot?: string;
}
