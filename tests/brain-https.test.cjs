const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { createServer, get } = require('node:https');
const { once } = require('node:events');

test('local HTTPS setup generates trusted-by-fixture TLS and never overwrites a configured setup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-https-'));
  let server;
  try {
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'apps/web'), { recursive: true });
    const script = join(dir, 'scripts/setup-brain-https.mjs');
    copyFileSync(join(__dirname, '../scripts/setup-brain-https.mjs'), script);
    writeFileSync(join(dir, 'apps/web/.env'), 'ROSIE_ORIGIN=http://127.0.0.1:19865\nPORT=19865\n');
    execFileSync(process.execPath, [script], { stdio: 'pipe' });
    const config = readFileSync(join(dir, 'apps/web/.env'), 'utf8');
    assert.match(config, /ROSIE_ORIGIN=https:\/\/127.0.0.1:19866/);
    assert.match(config, /ROSIE_HTTP_REDIRECT_PORT=19865/);
    const cert = readFileSync(join(dir, 'apps/web/.local/tls/certificate.pem'));
    const key = readFileSync(join(dir, 'apps/web/.local/tls/key.pem'));
    server = createServer({ cert, key }, (_req, res) => res.end('fixture-ready'));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const body = await new Promise((resolve, reject) => {
      get({ hostname: '127.0.0.1', port: server.address().port, ca: cert }, (res) => {
        let text = '';
        res.on('data', (part) => (text += part));
        res.on('end', () => resolve(text));
      }).on('error', reject);
    });
    assert.equal(body, 'fixture-ready');
    assert.throws(() => execFileSync(process.execPath, [script], { stdio: 'pipe' }), /already configured/);
    assert.equal(readFileSync(join(dir, 'apps/web/.env'), 'utf8'), config);
    assert.deepEqual(readFileSync(join(dir, 'apps/web/.local/tls/key.pem')), key);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
