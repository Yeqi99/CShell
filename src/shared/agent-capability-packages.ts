import { z } from 'zod';

const version = z.string().regex(/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/);
export const capabilityVersionRangeSchema = z.object({ min: version, maxExclusive: version }).strict();
const name = z.string().regex(/^[a-z][a-z0-9.-]{0,99}$/);
const callableName = z.string().regex(/^[a-z][a-z0-9_.-]{0,99}$/);
const relativeFile = z.string().min(1).max(240).refine(value => {
  if (value.includes('\\') || value.includes(':') || value.startsWith('/') || /[\x00-\x1f\x7f]/.test(value)) return false;
  return value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part));
}, 'Expected a portable package-relative file path');
const schema = z.object({ type: z.literal('object'), properties: z.record(z.string(), z.unknown()).default({}), required: z.array(z.string()).max(100).optional(), additionalProperties: z.boolean().optional() }).passthrough();
/** Executed only by a host-created adapter. This is process isolation, not an OS sandbox. */
export const capabilityProcessSchema = z.object({
  protocol: z.literal('node-json-stdio-1'), entry: relativeFile,
  timeoutMs: z.number().int().min(100).max(120000).default(30000),
  maxOutputBytes: z.number().int().min(1024).max(1048576).default(262144),
  maxConcurrency: z.number().int().min(1).max(4).default(1),
}).strict();
export const agentCapabilityManifestSchema = z.object({
  protocol: z.literal(1), id: name, name: z.string().min(1).max(80), version,
  license: z.literal('MIT'), description: z.string().max(1000),
  source: z.object({
    repository: z.string().regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    releaseTag: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
    assetUrl: z.string().url().max(1000),
  }).strict(),
  compatibility: z.object({
    platforms: z.array(z.enum(['win32', 'linux', 'darwin'])).min(1).max(3),
    architectures: z.array(z.enum(['x64', 'arm64'])).min(1).max(2),
    agentVersion: capabilityVersionRangeSchema,
  }).strict(),
  adapterId: name,
  process: capabilityProcessSchema.optional(),
  systemApplication: z.object({ id: name, version: capabilityVersionRangeSchema }).strict().optional(),
  files: z.array(z.object({ path: relativeFile, sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().min(0).max(2 ** 31) }).strict()).min(1).max(128),
  permissions: z.array(name).max(64),
  tools: z.array(z.object({ id: callableName, description: z.string().min(1).max(1000), inputSchema: schema, outputSchema: schema, permissions: z.array(name).max(64), sideEffect: z.boolean() }).strict()).max(100),
  events: z.array(z.object({ id: callableName, description: z.string().min(1).max(1000), payloadSchema: schema, permissions: z.array(name).max(64) }).strict()).max(100).default([]),
}).strict().superRefine((manifest, ctx) => {
  const prefix = `${manifest.source.repository}/releases/download/${manifest.source.releaseTag}/`;
  if (!manifest.source.assetUrl.startsWith(prefix) || !/^[A-Za-z0-9_.-]+$/.test(manifest.source.assetUrl.slice(prefix.length))) ctx.addIssue({ code: 'custom', path: ['source', 'assetUrl'], message: 'Asset must belong to this exact GitHub repository and release' });
  const duplicate = (values: string[]) => new Set(values).size !== values.length;
  if (duplicate(manifest.files.map(file => file.path.toLowerCase())) || duplicate(manifest.permissions) || duplicate(manifest.tools.map(tool => tool.id)) || duplicate(manifest.events.map(event => event.id))) ctx.addIssue({ code: 'custom', message: 'Duplicate file, permission, tool or event ID' });
  for (const capability of [...manifest.tools, ...manifest.events]) if (capability.permissions.some(permission => !manifest.permissions.includes(permission))) ctx.addIssue({ code: 'custom', message: 'Capability references an undeclared permission' });
  if (manifest.process) {
    if (!/\.(?:cjs|mjs|js)$/.test(manifest.process.entry) || !manifest.files.some(file => file.path === manifest.process!.entry)) ctx.addIssue({ code: 'custom', path: ['process', 'entry'], message: 'Process entry must be a declared JavaScript file' });
    if (manifest.events.length || manifest.tools.some(tool => !tool.permissions.includes('extension.execute')) || !manifest.permissions.includes('extension.execute')) ctx.addIssue({ code: 'custom', message: 'Process tools require explicit extension.execute authorization; process events are unsupported' });
  }
});
export type AgentCapabilityManifest = z.infer<typeof agentCapabilityManifestSchema>;
export type CapabilityPackageStatus = 'not-installed' | 'not-configured' | 'authorization-required' | 'available' | 'incompatible' | 'fault';
export interface CapabilityPackageRecord {
  id: string; version: string; root: string; manifestJson: string; manifestSha256: string;
  grants: string[]; status: CapabilityPackageStatus; reason?: string;
}
export interface CapabilityPackageView {
  id: string; name: string; version: string; status: CapabilityPackageStatus; reason?: string;
  grants: string[]; requiredPermissions: string[]; registered: boolean;
}
