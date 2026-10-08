import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const globalStyles = readFileSync(resolve(root, 'app/globals.css'), 'utf8');
const imports = [...globalStyles.matchAll(/@import ['"](.+?)['"];\n/g)];
const styles = imports.map((match) => readFileSync(resolve(root, 'app', match[1]), 'utf8')).join('\n');
writeFileSync(
  resolve(root, 'apps/web/public/companion.css'),
  `/* Generated from the original Jarvis interface. */\n@scope (body.jarvis-companion) {\nbutton, .button { min-height: 0; padding: 0; display: inline-block; gap: normal; font-weight: normal; line-height: normal; vertical-align: baseline; }\n.panel { padding: 0; }\n${styles
    .replaceAll(':root', ':scope')
    .replace(/(?<![\w.#-])body(?![\w-])/g, ':scope')
    .replaceAll('.focus-mode', ':scope.focus-mode')
    .replaceAll('.low-motion', ':scope.low-motion')}\n}\n`,
);
