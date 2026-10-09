import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2).filter((value) => value !== '--');

function run(argv, env = process.env) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, argv, { cwd: root, stdio: 'inherit', env });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) console.error(`O processo do companion encerrou com o sinal ${signal}.`);
      done(code ?? 1);
    });
  });
}

try {
  const compiled = await run([require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.node.json']);
  if (compiled !== 0) {
    console.error(`A compilação do companion falhou (código ${compiled}).`);
    process.exitCode = compiled;
  } else {
    // Application flags must not reach Chromium's native command-line parser.
    const code = await run([require.resolve('electron/cli.js'), resolve(root, 'desktop/companion')], {
      ...process.env,
      JARVIS_COMPANION_ARGUMENTS: JSON.stringify(args),
    });
    if (code !== 0) console.error(`O Electron encerrou o companion (código ${code}).`);
    process.exitCode = code;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
