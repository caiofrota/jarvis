import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { isIP } from 'node:net';

const root = resolve(import.meta.dirname, '..');
const envFile = resolve(root, 'apps/web/.env');
let env = readFileSync(envFile, 'utf8');
const origin = env
  .match(/^ROSIE_ORIGIN=(.+)$/m)?.[1]
  ?.trim()
  .replace(/^['"]|['"]$/g, '');
if (!origin) throw new Error('Set ROSIE_ORIGIN in apps/web/.env first.');
const url = new URL(origin);
if (url.protocol === 'https:') throw new Error('HTTPS is already configured.');
if (url.protocol !== 'http:') throw new Error('The configured origin must use HTTP or HTTPS.');
const oldPort = Number(url.port || 80);
const port = oldPort + 1;
if (port > 65535) throw new Error('Choose a lower HTTP port first.');
const directory = resolve(root, 'apps/web/.local/tls');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const cert = resolve(directory, 'certificate.pem'),
  key = resolve(directory, 'key.pem');
if (existsSync(cert) || existsSync(key)) throw new Error('Existing TLS files require manual configuration.');
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '90',
    '-keyout',
    key,
    '-out',
    cert,
    '-subj',
    '/CN=Jarvis local',
    '-addext',
    `subjectAltName=${isIP(url.hostname) ? 'IP' : 'DNS'}:${url.hostname},DNS:localhost,IP:127.0.0.1`,
  ],
  { stdio: 'ignore' },
);
chmodSync(cert, 0o600);
chmodSync(key, 0o600);
url.protocol = 'https:';
url.port = String(port);
const values = {
  ROSIE_ORIGIN: url.origin,
  PORT: String(port),
  ROSIE_TLS_CERT_FILE: cert,
  ROSIE_TLS_KEY_FILE: key,
  ROSIE_HTTP_REDIRECT_PORT: String(oldPort),
};
for (const [name, value] of Object.entries(values)) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  env = pattern.test(env) ? env.replace(pattern, line) : `${env.trimEnd()}\n${line}\n`;
}
writeFileSync(envFile, env, { mode: 0o600 });
console.log(
  `Restart dev:brain and open ${url.origin}. Trust apps/web/.local/tls/certificate.pem on your computer before testing the microphone. This certificate is for local development and expires in 90 days.`,
);
