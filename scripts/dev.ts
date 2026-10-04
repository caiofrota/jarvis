import { projectRoot } from '../lib/paths';
import next from 'next';
import { createServer } from '../server';
import { runtimeInfo } from '../lib/runtime';
async function main() {
  const port = Number(process.env.PORT || 4318);
  const application = next({ dir: projectRoot, dev: true, hostname: '127.0.0.1', port });
  await application.prepare();
  const server = createServer({ fallback: application.getRequestHandler() });
  server.on('error', (e) => {
    console.error(
      (e as NodeJS.ErrnoException).code === 'EADDRINUSE'
        ? 'Já existe um Jarvis na porta 4318. Encerre o anterior.'
        : e.message,
    );
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log('Jarvis: http://127.0.0.1:' + port + ' · alterações atualizadas automaticamente');
    if (runtimeInfo().restricted) console.log(runtimeInfo().message);
  });
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
