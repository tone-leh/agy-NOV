import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const testDir = path.join(rootDir, 'test');

const testFiles = fs
  .readdirSync(testDir)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => path.join('test', name));

if (testFiles.length === 0) {
  console.error('No test/*.test.ts files found');
  process.exit(1);
}

const extraArgs = process.argv.slice(2);
const res = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...extraArgs, ...testFiles],
  {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
  },
);

if (res.error) {
  console.error(res.error);
  process.exit(1);
}
process.exit(res.status ?? 1);
