import { createHash } from 'node:crypto';
import { appInstallInput, appPlanInput, appTaskInput } from '../shared/agent-applications';
import { z } from 'zod';
import type { AgentCapabilityManifest } from '../shared/agent-capability-packages';

export const capabilityDigest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export interface CapabilityCatalogEntry {
  id: string; name: string; version: string; description: string; permissions: string[];
  manifestSha256: string; bundleSha256: string; bundleBytes: number;
  source: 'bundled' | 'github'; bundle?: string; url?: string;
}
export interface CapabilityBundle { protocol: 1; manifest: string; files: Record<string, string> }
const contract = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'input' }) as AgentCapabilityManifest['tools'][number]['inputSchema'];
const output = { type: 'object' as const, properties: {}, additionalProperties: true };
const notice = 'MIT\nSystem application tools are implemented by the trusted cagent runtime. This package contains declarations only.\n';
const manifest: AgentCapabilityManifest = {
  protocol: 1, id: 'cagent.system-apps', name: '系统应用管理', version: '1.0.0', license: 'MIT',
  description: '检查常用系统应用安装计划并管理安装任务。系统安装授权与工具授权分别生效。',
  // Provenance only: this bundled declaration is not advertised as an uploaded release asset.
  source: { repository: 'https://github.com/Yeqi99/CShell', releaseTag: 'capability-system-apps-1.0.0', assetUrl: 'https://github.com/Yeqi99/CShell/releases/download/capability-system-apps-1.0.0/system-apps.cagent-package.json' },
  compatibility: { platforms: ['win32', 'linux', 'darwin'], architectures: ['x64', 'arm64'], agentVersion: { min: '0.6.9', maxExclusive: '1.0.0' } },
  adapterId: 'cagent.system-apps', files: [{ path: 'NOTICE.txt', bytes: Buffer.byteLength(notice), sha256: capabilityDigest(notice) }],
  permissions: ['applications.read', 'applications.plan', 'applications.install'],
  tools: [
    { id: 'system_apps_catalog', description: 'Read actual package manager and supported application catalog on this cagent host.', inputSchema: contract(z.object({}).strict()), outputSchema: output, permissions: ['applications.read'], sideEffect: false },
    { id: 'system_apps_plan', description: 'Inspect one supported application and produce a short-lived install plan. Does not install. Requires separately enabled system installation permission.', inputSchema: contract(appPlanInput), outputSchema: output, permissions: ['applications.plan'], sideEffect: false },
    { id: 'system_apps_status', description: 'Read one installation task belonging to this caller.', inputSchema: contract(appTaskInput), outputSchema: output, permissions: ['applications.read'], sideEffect: false },
    { id: 'system_apps_install', description: 'Execute an inspected installation plan only after explicit approval. Separate system installation permission still applies. Unknown results must be queried, never blindly retried.', inputSchema: contract(appInstallInput), outputSchema: output, permissions: ['applications.install'], sideEffect: true },
    { id: 'system_apps_cancel', description: 'Cancel an installation task belonging to this caller. Completed system changes are not rolled back.', inputSchema: contract(appTaskInput), outputSchema: output, permissions: ['applications.install'], sideEffect: true },
  ], events: [],
};
// Tool IDs contain underscores because they are callable API names; package and permission IDs remain dotted.
const manifestJson = JSON.stringify(manifest);
const bundled = JSON.stringify({ protocol: 1, manifest: manifestJson, files: { 'NOTICE.txt': Buffer.from(notice).toString('base64') } } satisfies CapabilityBundle);
const catalog: CapabilityCatalogEntry[] = [{ id: manifest.id, name: manifest.name, version: manifest.version, description: manifest.description, permissions: manifest.permissions,
  source: 'bundled', bundle: bundled, bundleBytes: Buffer.byteLength(bundled), bundleSha256: capabilityDigest(bundled), manifestSha256: capabilityDigest(manifestJson) }];
export function capabilityCatalog() { return structuredClone(catalog); }
export function createBundledCapabilityEntry(manifest: AgentCapabilityManifest, files: Record<string, Uint8Array>): CapabilityCatalogEntry {
  const fileEntries=Object.entries(files);
  const complete={...manifest,files:fileEntries.map(([path,bytes])=>({path,bytes:bytes.byteLength,sha256:capabilityDigest(bytes)}))};
  const raw=JSON.stringify(complete);
  const bundle=JSON.stringify({protocol:1,manifest:raw,files:Object.fromEntries(fileEntries.map(([path,bytes])=>[path,Buffer.from(bytes).toString('base64')]))} satisfies CapabilityBundle);
  return {id:manifest.id,name:manifest.name,version:manifest.version,description:manifest.description,permissions:[...manifest.permissions],source:'bundled',bundle,bundleBytes:Buffer.byteLength(bundle),bundleSha256:capabilityDigest(bundle),manifestSha256:capabilityDigest(raw)};
}
