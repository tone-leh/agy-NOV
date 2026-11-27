import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

fs.mkdirSync('dist', { recursive: true });

const uiIndex = path.resolve('dist/ui/index.html');
const uiApp = path.resolve('dist/ui/app.html');
if (fs.existsSync(uiIndex)) {
  fs.renameSync(uiIndex, uiApp);
}
if (!fs.existsSync(uiApp)) {
  throw new Error('Missing dist/ui/app.html — run npm run build:ui first.');
}

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
};

await Promise.all([
  build({
    ...common,
    entryPoints: ['src/server/index.ts'],
    outfile: 'dist/server.cjs',
  }),
  build({
    ...common,
    entryPoints: ['src/hooks/dispatcher.ts'],
    outfile: 'dist/hook.cjs',
  }),
  build({
    ...common,
    entryPoints: ['src/server/cli.ts'],
    outfile: 'dist/cli.cjs',
  }),
]);

const uiSizeKb = (fs.statSync(uiApp).size / 1024).toFixed(1);
const serverSizeKb = (fs.statSync('dist/server.cjs').size / 1024).toFixed(1);
const hookSizeKb = (fs.statSync('dist/hook.cjs').size / 1024).toFixed(1);
const cliSizeKb = (fs.statSync('dist/cli.cjs').size / 1024).toFixed(1);
console.log(
  `Bundled agy-NOV v0.2.0: server.cjs (${serverSizeKb} KB), hook.cjs (${hookSizeKb} KB), cli.cjs (${cliSizeKb} KB), ui/app.html (${uiSizeKb} KB)`,
);
