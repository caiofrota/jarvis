const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

for (const compilerExit of [0, 2]) {
  test(`remote launcher preserves Windows paths without native flags; compiler exit ${compilerExit}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-launcher-'));
    try {
      for (const directory of ['scripts', 'node_modules/typescript/bin', 'node_modules/electron'])
        mkdirSync(join(root, directory), { recursive: true });
      writeFileSync(join(root, 'scripts/start-companion.mjs'), readFileSync('scripts/start-companion.mjs'));
      writeFileSync(join(root, 'node_modules/typescript/bin/tsc.js'), `process.exit(${compilerExit});`);
      const output = join(root, 'launch.json');
      writeFileSync(
        join(root, 'node_modules/electron/cli.js'),
        'require("node:fs").writeFileSync(process.env.JARVIS_LAUNCH_OUTPUT, JSON.stringify({ argv: process.argv.slice(2), args: JSON.parse(process.env.JARVIS_COMPANION_ARGUMENTS) }));',
      );
      const args = [
        '--server',
        'https://fixture.test',
        '--certificate',
        'C:\\Users\\Example User\\Downloads\\certificate.cer',
      ];
      const result = spawnSync(process.execPath, [join(root, 'scripts/start-companion.mjs'), ...args], {
        env: { ...process.env, JARVIS_LAUNCH_OUTPUT: output },
        encoding: 'utf8',
      });
      assert.equal(result.status, compilerExit, result.stderr);
      if (compilerExit === 0) {
        const launched = JSON.parse(readFileSync(output, 'utf8'));
        assert.deepEqual(launched.argv, [join(root, 'desktop/companion')]);
        assert.deepEqual(launched.args, args);
      } else {
        assert.throws(() => readFileSync(output));
        assert.match(result.stderr, /compilação.*código 2/);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
