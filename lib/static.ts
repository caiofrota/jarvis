import type { IncomingMessage, ServerResponse } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL, root: string) {
  let name;
  try {
    name = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (name === '/' || name === '/index.html') name = '/index.html';
  const target = path.resolve(root, '.' + name);
  if (
    req.method !== 'GET' ||
    !target.startsWith(path.resolve(root) + path.sep) ||
    !types[path.extname(target)]
  ) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  fs.readFile(target, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('Interface indisponível. Execute a preparação do Jarvis primeiro.');
      return;
    }
    res.writeHead(200, {
      'Content-Type': types[path.extname(target)],
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}
export { serveStatic };
