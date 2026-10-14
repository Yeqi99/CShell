import { createHash, randomUUID } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, release } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { wslNetworkInput, type WslNetworkInput, type WslNetworkState } from '../shared/wsl-network';
import { decodeWslOutput } from './wsl-setup';
const exec = promisify(execFile);
export const wslRevision = (text: string) => createHash('sha256').update(text).digest('hex');
export function parseWslNetwork(text: string) {
  let section = '',
    sections = 0,
    mode = 'nat',
    autoProxy = true;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*(?:[#;].*)?$/);
    if (header) {
      section = header[1].toLowerCase();
      if (section === 'wsl2') sections++;
      continue;
    }
    if (section !== 'wsl2') continue;
    const pair = line.match(/^\s*(networkingMode|autoProxy)\s*=\s*([^#;]*?)(?:\s*[#;].*)?$/i);
    if (pair?.[1].toLowerCase() === 'networkingmode') mode = pair[2].trim().toLowerCase();
    if (pair?.[1].toLowerCase() === 'autoproxy') {
      if (!/^(true|false)$/i.test(pair[2].trim()))
        throw new Error('Invalid autoProxy value in .wslconfig');
      autoProxy = pair[2].trim().toLowerCase() === 'true';
    }
  }
  if (sections > 1)
    throw new Error('Multiple [wsl2] sections in .wslconfig; resolve them before saving');
  return { mode, autoProxy };
}
export function updateWslNetwork(text: string, input: Pick<WslNetworkInput, 'mode' | 'autoProxy'>) {
  parseWslNetwork(text);
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const out: string[] = [];
  let inside = false,
    found = false,
    written = false;
  const settings = () => {
    if (!written) {
      out.push('networkingMode=' + input.mode, 'autoProxy=' + input.autoProxy);
      written = true;
    }
  };
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*(?:[#;].*)?$/);
    if (header) {
      if (inside) settings();
      inside = header[1].toLowerCase() === 'wsl2';
      if (inside) found = true;
    }
    if (inside && /^\s*(networkingMode|autoProxy)\s*=/i.test(line)) continue;
    out.push(line);
  }
  if (!found) out.push('[wsl2]');
  settings();
  return bom + out.join(newline).replace(/\s*$/, '') + newline;
}
export class WslNetworkSettings {
  private tail = Promise.resolve();
  constructor(private directory = homedir()) {}
  private async source() {
    try {
      const data = await readFile(join(this.directory, '.wslconfig'));
      if (data.length > 65536 || data.includes(0) || !isUtf8(data))
        throw new Error('Unsupported .wslconfig size or encoding');
      return data.toString('utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw e;
    }
  }
  async read(): Promise<WslNetworkState> {
    const text = await this.source();
    const system = join(process.env.SystemRoot || 'C:/Windows', 'System32');
    const version = await exec(join(system, 'wsl.exe'), ['--version'], {
      encoding: 'buffer',
      windowsHide: true,
      timeout: 10000,
    }).then(
      (r) => decodeWslOutput(r.stdout),
      () => '',
    );
    const proxyScript =
      "$p=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; if($p.ProxyEnable -eq 1 -and $p.ProxyServer -match '(localhost|127\\.0\\.0\\.1|\\[::1\\])'){Write-Output yes}";
    const localhostProxy = await exec(
      join(system, 'WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', proxyScript],
      { windowsHide: true, timeout: 10000 },
    ).then(
      (r) => r.stdout.trim() === 'yes',
      () => false,
    );
    return {
      ...parseWslNetwork(text),
      revision: wslRevision(text),
      mirroredSupported:
        Number(release().split('.')[2]) >= 22621 &&
        Number(version.match(/(\d+)\.\d+\.\d+/)?.[1] ?? 0) >= 2,
      localhostProxy,
    };
  }
  async save(raw: unknown) {
    const input = wslNetworkInput.parse(raw);
    const operation = this.tail.then(async () => {
      const state = await this.read();
      if (input.mode === 'mirrored' && !state.mirroredSupported)
        throw new Error('Mirrored networking requires Windows 11 22H2 and WSL 2.0 or newer');
      const text = await this.source();
      if (wslRevision(text) !== input.revision)
        throw new Error('WSL configuration changed. Refresh before saving.');
      const next = updateWslNetwork(text, input);
      const filename = join(this.directory, '.wslconfig');
      const temp = filename + '.' + randomUUID() + '.tmp';
      try {
        if (text)
          await writeFile(filename + '.cshell-' + randomUUID() + '.bak', text, { flag: 'wx' });
        await writeFile(temp, next, { flag: 'wx' });
        if (wslRevision(await this.source()) !== input.revision)
          throw new Error('WSL configuration changed. Refresh before saving.');
        await rename(temp, filename);
      } finally {
        await unlink(temp).catch(() => {});
      }
    });
    this.tail = operation.catch(() => {});
    await operation;
    return this.read();
  }
  async shutdown() {
    await exec(join(process.env.SystemRoot || 'C:/Windows', 'System32/wsl.exe'), ['--shutdown'], {
      windowsHide: true,
      timeout: 30000,
    });
  }
}
