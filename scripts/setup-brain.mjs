import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = resolve(root, 'apps/web');
const local = resolve(app, '.local');
const env = resolve(app, '.env');
if (existsSync(env) || existsSync(local)) {
  throw new Error('Existing central configuration found. Refusing to overwrite it.');
}
mkdirSync(local, { mode: 0o700 });
for (const name of ['session.token', 'voice.token']) {
  writeFileSync(resolve(local, name), randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
}
const values = {
  DATABASE_URL: `file:${resolve(local, 'jarvis.sqlite').replaceAll('\\', '/')}`,
  ROSIE_ADMIN_TOKEN_FILE: resolve(local, 'session.token'),
  ROSIE_VOICE_TOKEN_FILE: resolve(local, 'voice.token'),
  ROSIE_VOICE_URL: 'http://127.0.0.1:8766',
  ROSIE_ORIGIN: 'http://127.0.0.1:18765',
  PORT: '18765',
  HOST: '127.0.0.1',
};
writeFileSync(
  env,
  Object.entries(values)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('\n') + '\n',
  { mode: 0o600, flag: 'wx' },
);
console.log(
  'Created private central configuration on port 18765. No existing Rosie installation was changed.',
);
console.log('Next: export apps/web/.env, run db:deploy, db:init, user:create-first, then dev:brain.');
