import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const child = spawn(
  process.execPath,
  [
    require.resolve('electron/cli.js'),
    resolve(root, 'dist/desktop/companion-main.js'),
    ...process.argv.slice(2).filter((value) => value !== '--'),
  ],
  { cwd: root, stdio: 'inherit' },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
