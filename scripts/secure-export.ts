import { projectRoot } from '../lib/paths';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
const root = path.join(projectRoot, 'out');
function secure(dir: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      secure(file);
      continue;
    }
    if (!file.endsWith('.html')) continue;
    let html = fs.readFileSync(file, 'utf8');
    const hashes = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
      .filter((m) => m[1])
      .map((m) => "'sha256-" + crypto.createHash('sha256').update(m[1]).digest('base64') + "'");
    const policy =
      "default-src 'self'; script-src 'self' " +
      hashes.join(' ') +
      "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
    html = html.replace(
      '<head>',
      '<head><meta http-equiv="Content-Security-Policy" content="' + policy + '">',
    );
    fs.writeFileSync(file, html);
  }
}
secure(root);
