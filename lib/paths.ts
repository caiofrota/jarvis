import * as path from 'node:path';
import * as fs from 'node:fs';
// Works both from source via tsx and from dist/lib in the packaged desktop app.
export const projectRoot = fs.existsSync(path.resolve(__dirname, '../package.json'))
  ? path.resolve(__dirname, '..')
  : path.resolve(__dirname, '../..');
