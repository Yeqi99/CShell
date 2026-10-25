import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const bytes = await readFile(new URL('./echo.cjs', import.meta.url));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const capability = {
  protocol: 1, id: 'example.echo', name: '文本大写', version: '1.0.0', license: 'MIT', description: '将输入文本转换为大写。',
  // Replace with your repository/release provenance before distributing your own extension.
  source: { repository: 'https://github.com/Yeqi99/CShell', releaseTag: 'example-process-1.0.0', assetUrl: 'https://github.com/Yeqi99/CShell/releases/download/example-process-1.0.0/example.echo.cshellext' },
  compatibility: { platforms: ['win32', 'linux', 'darwin'], architectures: ['x64', 'arm64'], agentVersion: { min: '0.8.9', maxExclusive: '1.0.0' } },
  adapterId: 'example.echo', process: { protocol: 'node-json-stdio-1', entry: 'echo.cjs', timeoutMs: 10000, maxOutputBytes: 65536, maxConcurrency: 1 },
  files: [{ path: 'echo.cjs', bytes: bytes.length, sha256 }], permissions: ['extension.execute'],
  tools: [{ id: 'uppercase', description: 'Convert explicitly supplied text to upper case on this host.', inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 2000 } }, required: ['text'], additionalProperties: false }, outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, permissions: ['extension.execute'], sideEffect: false }], events: [],
};
const pack = { format: 'cshell-extension-1', manifest: { protocol: 1, id: capability.id, name: capability.name, version: capability.version, description: capability.description, publisher: 'Example', provider: 'process', permissions: ['remote.execute'], capability }, files: [{ path: 'echo.cjs', sha256, data: bytes.toString('base64') }] };
await writeFile(new URL('./example.echo.cshellext', import.meta.url), JSON.stringify(pack));
console.log('Created example.echo.cshellext (unsigned; importing does not authorize execution).');
