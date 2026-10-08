import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { resolve, dirname } from 'node:path';
const root = resolve(import.meta.dirname, '..');
let source,
  output = resolve(root, 'apps/web/.local/tls/jarvis-local.cer');
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index],
    value = process.argv[++index];
  if (!value || !['--source', '--output'].includes(key))
    throw new Error('Use --source certificate.pem and/or --output jarvis-local.cer.');
  if (key === '--source') source = resolve(value);
  else output = resolve(value);
}
if (!source) {
  const env = readFileSync(resolve(root, 'apps/web/.env'), 'utf8');
  const value = env
    .match(/^ROSIE_TLS_CERT_FILE=(.+)$/m)?.[1]
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (!value) throw new Error('The central server must have HTTPS configured first.');
  source = resolve(value);
}
const certificate = new X509Certificate(readFileSync(source));
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
writeFileSync(output, certificate.raw, { mode: 0o600 });
console.log(`Exported the public certificate to ${output}. No private key was exported.`);
