const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { X509Certificate } = require('node:crypto');
const {
  companionOrigin,
  sameServer,
  externalWebLink,
  systemAccountSetup,
} = require('../dist/packages/api-client/src/connection');
const { companionOptions } = require('../dist/lib/companion-options');
const {
  acceptsCompanionCertificate,
  companionCertificateDecision,
} = require('../dist/lib/companion-certificate');

test('native companions accept only canonical HTTPS server origins', () => {
  assert.equal(companionOrigin(' https://example.test:18766/studio '), 'https://example.test:18766');
  assert.equal(companionOrigin('https://192.168.0.2:18766'), 'https://192.168.0.2:18766');
  for (const value of [
    'http://example.test',
    'file:///tmp/entry',
    'https://user:secret@example.test',
    'https://example.test/?token=secret',
    'https://example.test/#value',
    'https://example.test/not-a-server',
    'not a URL',
  ])
    assert.throws(() => companionOrigin(value));
  assert.equal(sameServer('https://example.test/studio', 'https://example.test'), true);
  assert.equal(sameServer('https://example.test:18766/studio', 'https://example.test'), false);
  assert.equal(sameServer('https://example.test.attacker.invalid/studio', 'https://example.test'), false);
  assert.equal(externalWebLink('https://calendar.example.test/'), true);
  assert.equal(externalWebLink('javascript:alert(1)'), false);
  assert.equal(externalWebLink('file:///etc/passwd'), false);
  assert.equal(systemAccountSetup('https://example.test/integrations', 'https://example.test'), true);
  assert.equal(systemAccountSetup('https://attacker.invalid/integrations', 'https://example.test'), false);
});
test('desktop connection arguments preserve a saved server and drop a pin on server change', () => {
  const saved = { origin: 'https://example.test', certificate: 'certificate.cer' };
  assert.deepEqual(companionOptions([], saved), saved);
  assert.deepEqual(companionOptions(['--server', 'https://other.test'], saved), {
    origin: 'https://other.test',
    certificate: undefined,
  });
  assert.throws(() => companionOptions([]));
  assert.throws(() => companionOptions(['--server']));
  assert.throws(() => companionOptions(['--unknown', 'value']));
});
test('local certificate trust requires the exact certificate, valid dates and matching SAN', () => {
  const directory = mkdtempSync(join(tmpdir(), 'jarvis-companion-cert-'));
  try {
    for (const name of ['first', 'second'])
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-days',
          '1',
          '-keyout',
          join(directory, `${name}.key`),
          '-out',
          join(directory, `${name}.pem`),
          '-subj',
          '/CN=fixture',
          '-addext',
          'subjectAltName=DNS:fixture.test,IP:127.0.0.1',
        ],
        { stdio: 'ignore' },
      );
    const first = readFileSync(join(directory, 'first.pem')),
      second = readFileSync(join(directory, 'second.pem'));
    const cert = new X509Certificate(first);
    assert.equal(acceptsCompanionCertificate(first, first, 'fixture.test'), true);
    assert.equal(acceptsCompanionCertificate(cert.raw, first, '127.0.0.1'), true);
    assert.equal(acceptsCompanionCertificate(first, second, 'fixture.test'), false);
    assert.equal(acceptsCompanionCertificate(first, first, 'attacker.test'), false);
    assert.equal(
      acceptsCompanionCertificate(first, first, 'fixture.test', Date.parse(cert.validTo) + 1),
      false,
    );
    assert.equal(
      acceptsCompanionCertificate(first, first, 'fixture.test', Date.parse(cert.validFrom) - 1),
      false,
    );
    assert.equal(acceptsCompanionCertificate('invalid', first, 'fixture.test'), false);
    assert.equal(companionCertificateDecision('fixture.test', 'fixture.test', -202, first, first), 0);
    assert.equal(companionCertificateDecision('fixture.test', 'fixture.test', 0, first, first), -3);
    assert.equal(companionCertificateDecision('fixture.test', 'fixture.test', 0, second, first), -2);
    assert.equal(companionCertificateDecision('fixture.test', 'fixture.test', -201, first, first), -2);
    assert.equal(companionCertificateDecision('other.test', 'fixture.test', 0, first, first), -3);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('Android local CA configuration is optional and scoped to one host', () => {
  const { certificateConfig } = require('../apps/mobile/plugins/with-local-certificate.cjs');
  assert.equal(certificateConfig(''), null);
  const xml = certificateConfig('192.168.0.2');
  assert.ok(xml.includes('<domain includeSubdomains="false">192.168.0.2</domain>'));
  assert.ok(xml.includes('cleartextTrafficPermitted="false"'));
  assert.throws(() => certificateConfig('https://example.test'));
  assert.throws(() => certificateConfig('example.test</domain>'));
});
