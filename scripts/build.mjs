import { build } from 'esbuild';
await build({
  entryPoints: ['src/desktop/entry.ts'],
  define: {__CSHELL_PRO__: JSON.stringify(process.env.CSHELL_EDITION === 'pro')},
  outfile: 'dist/main/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['node-pty', 'electron', 'ssh2', '@modelcontextprotocol/sdk', 'selfsigned'],
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

await build({entryPoints:["src/agent/cli.ts"],outfile:"dist/agent/agent.cjs",bundle:true,platform:"node",format:"cjs",target:"node22",external:["node-pty"]});

await build({entryPoints:['src/cli/entry.ts'],define:{__CSHELL_PRO__:JSON.stringify(process.env.CSHELL_EDITION==='pro')},outfile:'dist/cli/cshell.mjs',bundle:true,platform:'node',format:'esm',target:'node22'});
