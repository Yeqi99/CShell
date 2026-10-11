import { dialog, nativeImage, type BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, basename, extname } from 'node:path';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { appearanceAssetSchema } from '../shared/contracts';

const execute = promisify(execFile);
const maxBytes = 20 * 1024 * 1024;
const fontMime: Record<string, string> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  png: 'image/png',
};

export function registerAppearanceHandlers(
  handle: (name: string, fn: (...args: any[]) => any) => void,
  window: BrowserWindow,
  userData: string,
  consume: (token: string) => string,
  text: (cn: string, en: string) => string,
) {
  const directory = join(userData, 'appearance');
  let fontRequest: Promise<string[]> | undefined;
  handle('appearance:fonts', () => {
    if (process.platform !== 'win32')
      throw new Error(
        text('本机字体检测暂支持 Windows', 'System font detection currently supports Windows'),
      );
    // Fixed command, no interpolated user input; no visible shell window.
    fontRequest ??= execute(
      join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; $collection = New-Object System.Drawing.Text.InstalledFontCollection; try { ConvertTo-Json -Compress -InputObject @($collection.Families | ForEach-Object { $_.Name } | Sort-Object -Unique) } finally { $collection.Dispose() }',
      ],
      { windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' },
    )
      .then(({ stdout }) =>
        z
          .array(z.string().max(200))
          .max(20000)
          .parse(JSON.parse(stdout.replace(/^\uFEFF/, ''))),
      )
      .catch((error) => {
        fontRequest = undefined;
        throw error;
      });
    return fontRequest;
  });
  handle('appearance:import', async (kindInput, token) => {
    const kind = z.enum(['font', 'background']).parse(kindInput);
    let path: string;
    if (token !== undefined) path = consume(z.string().uuid().parse(token));
    else {
      const result = await dialog.showOpenDialog(window, {
        title:
          kind === 'font'
            ? text('导入字体', 'Import font')
            : text('选择背景图片', 'Choose background image'),
        properties: ['openFile'],
        filters: [
          {
            name: kind === 'font' ? text('字体', 'Fonts') : text('图片', 'Images'),
            extensions:
              kind === 'font' ? ['ttf', 'otf', 'woff', 'woff2'] : ['png', 'jpg', 'jpeg', 'webp'],
          },
        ],
      });
      if (result.canceled) return null;
      path = result.filePaths[0];
    }
    const extension = extname(path).slice(1).toLowerCase();
    if (
      !(
        kind === 'font' ? ['ttf', 'otf', 'woff', 'woff2'] : ['png', 'jpg', 'jpeg', 'webp']
      ).includes(extension)
    )
      throw new Error(text('不支持此文件格式', 'Unsupported file format'));
    const file = await open(path, 'r');
    let bytes: Buffer;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > maxBytes || info.size < 4)
        throw new Error(
          text('请选择 20 MB 以内的有效文件', 'Select a valid file smaller than 20 MB'),
        );
      // Bound the actual read, including files which grow after stat.
      const buffer = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > maxBytes) throw new Error(text('文件超过 20 MB', 'File exceeds 20 MB'));
      bytes = buffer.subarray(0, bytesRead);
    } finally {
      await file.close();
    }
    let suffix = extension;
    if (kind === 'font') {
      const magic = bytes.subarray(0, 4).toString('hex');
      const signatures: Record<string, string[]> = {
        ttf: ['00010000', '74727565'],
        otf: ['4f54544f'],
        woff: ['774f4646'],
        woff2: ['774f4632'],
      };
      if (!signatures[extension]?.includes(magic))
        throw new Error(text('无效的字体文件', 'Invalid font file'));
    } else {
      let image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) throw new Error(text('无法读取图片', 'Cannot decode image'));
      const size = image.getSize();
      if (Math.max(size.width, size.height) > 4096)
        image = image.resize(size.width >= size.height ? { width: 4096 } : { height: 4096 });
      bytes = image.toPNG();
      if (bytes.length > maxBytes)
        throw new Error(
          text('图片解码后过大，请缩小图片', 'Decoded image is too large; resize it first'),
        );
      suffix = 'png';
    }
    const id = `${createHash('sha256').update(bytes).digest('hex')}.${suffix}`;
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, id), bytes, { mode: 0o600 });
    return { id, name: basename(path).slice(0, 255) };
  });
  handle('appearance:data', async (value) => {
    const id = appearanceAssetSchema.shape.id.parse(value);
    const bytes = await readFile(join(directory, id));
    if (bytes.length > maxBytes) throw new Error('Appearance asset exceeds size limit');
    return `data:${fontMime[id.split('.').at(-1)!]};base64,${bytes.toString('base64')}`;
  });
}
