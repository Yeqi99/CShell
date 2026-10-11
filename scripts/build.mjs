import { build } from 'esbuild';
await build({
  entryPoints: ['src/desktop/main.ts'],
  outfile: 'dist/main/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'ssh2', '@modelcontextprotocol/sdk'],
  sourcemap: true,
});
await build({
  entryPoints: ['src/desktop/preload.ts'],
  outfile: 'dist/main/preload.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
