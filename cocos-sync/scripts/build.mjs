import { build, context } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

await mkdir(new URL('../dist/', import.meta.url), { recursive: true });

const options = {
  entryPoints: [new URL('../src/code.ts', import.meta.url).pathname],
  bundle: true,
  outfile: new URL('../dist/code.js', import.meta.url).pathname,
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  sourcemap: 'inline',
  logLevel: 'info',
};

await copyFile(new URL('../src/ui.html', import.meta.url), new URL('../dist/ui.html', import.meta.url));

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  process.stdout.write('Watching Figma companion plugin…\n');
} else {
  await build(options);
}
