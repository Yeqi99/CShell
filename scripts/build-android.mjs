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

await copyFile('assets/icon.png', `${directory}/icon.png`);
await copyFile('assets/icon.png', 'android/app/src/main/res/drawable/icon.png');

await copyFile('THIRD_PARTY_NOTICES.txt', `${directory}/THIRD_PARTY_NOTICES.txt`);
