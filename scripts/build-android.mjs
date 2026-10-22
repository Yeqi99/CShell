import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
const directory = 'android/app/src/main/assets';
await mkdir(directory, { recursive: true });
await build({
  entryPoints: ['android/web/app.ts'],
  outfile: `${directory}/app.js`,
  bundle: true,
  minify: true,
  target: 'chrome90',
  jsx: 'automatic',
});
await copyFile('android/web/index.html', `${directory}/index.html`);

const brandIcon = process.env.CSHELL_EDITION === 'pro' ? 'assets/brand/cshell-pro.png' : 'assets/icon.png';
await copyFile(brandIcon, `${directory}/icon.png`);
await copyFile(brandIcon, 'android/app/src/main/res/drawable/icon.png');

await copyFile('THIRD_PARTY_NOTICES.txt', `${directory}/THIRD_PARTY_NOTICES.txt`);
