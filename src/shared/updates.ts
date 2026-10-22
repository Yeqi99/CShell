import { downloadManifest, downloadPage, downloadRoot } from './download-source';
export interface UpdateState {
  current: string;
  phase:
    | 'idle'
    | 'checking'
    | 'current'
    | 'unavailable'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'error';
  version?: string;
  progress?: number;
  error?: string;
  platform: string;
  retry?: 'check' | 'download';
  automatic?: boolean;
}
export interface UpdateBridge {
  updateState(): Promise<UpdateState>;
  checkUpdate(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  openUpdatePage(): Promise<void>;
  updateAutomatic?(enabled: boolean): Promise<UpdateState>;
}
export const releasesPage = downloadPage;
export const releaseApi = downloadManifest;
export function compareVersion(a: string, b: string): number {
  const parse = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v);
  const x = parse(a),
    y = parse(b);
  if (!x || !y) throw new Error('Invalid release version');
  for (let i = 1; i < 4; i++) {
    const diff = Number(x[i]) - Number(y[i]);
    if (diff) return Math.sign(diff);
  }
  return 0;
}
export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}
export interface UpdateRelease {
  version: string;
  asset: ReleaseAsset;
  checksums: ReleaseAsset;
}
export function selectRelease(
  input: unknown,
  platform: string,
  arch: string,
): UpdateRelease | undefined {
  if (!Array.isArray(input)) throw new Error('更新目录格式不正确');
  const suffix =
    platform === 'win32' && arch === 'x64'
      ? 'win-x64.exe'
      : platform === 'darwin' && ['x64', 'arm64'].includes(arch)
        ? 'mac-' + arch + '.dmg'
        : platform === 'linux' && ['x64', 'arm64'].includes(arch)
          ? 'linux-' + (arch === 'x64' ? 'x86_64' : 'arm64') + '.AppImage'
          : undefined;
  if (!suffix) throw new Error('Unsupported update platform');
  const releases = input
    .filter((r) => r && !r.draft && /^v\d+\.\d+\.\d+$/.test(r.tag_name) && Array.isArray(r.assets))
    .sort((a, b) => compareVersion(b.tag_name, a.tag_name));
  for (const r of releases) {
    const version = r.tag_name.slice(1),
      name = 'CShell-' + version + '-' + suffix;
    const asset = r.assets.find((a: ReleaseAsset) => a.name === name),
      checksums = r.assets.find((a: ReleaseAsset) => a.name === 'SHA256SUMS.txt');
    if (!asset || !checksums) continue;
    for (const a of [asset, checksums]) {
      if (
        a.browser_download_url !==
          downloadRoot + '/' + r.tag_name + '/' + a.name ||
        !Number.isSafeInteger(a.size) ||
        a.size <= 0 ||
        a.size > 600_000_000
      )
        throw new Error('Invalid release asset');
    }
    return { version, asset, checksums };
  }
}
export function checksumFor(text: string, name: string): string {
  const entries = text
    .split(/\r?\n/)
    .map((line) => /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line))
    .filter((m) => m && m[2].replace(/^\.\//, '') === name);
  if (entries.length !== 1) throw new Error('Missing or ambiguous checksum');
  return entries[0]![1].toLowerCase();
}
