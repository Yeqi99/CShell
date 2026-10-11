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
});
await copyFile('android/web/index.html', `${directory}/index.html`);
