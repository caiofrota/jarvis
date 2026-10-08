import { companionOrigin } from '../packages/api-client/src/connection';
export function companionOptions(args: string[], saved?: { origin: string; certificate?: string }) {
  let origin = saved?.origin,
    certificate = saved?.certificate;
  let certificateProvided = false;
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!['--server', '--certificate'].includes(key)) throw new Error(`Opção desconhecida: ${key}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Informe um valor para ${key}.`);
    if (key === '--server') {
      origin = value;
    } else {
      certificate = value;
      certificateProvided = true;
    }
  }
  if (
    !certificateProvided &&
    saved?.origin &&
    origin &&
    companionOrigin(origin) !== companionOrigin(saved.origin)
  )
    certificate = undefined;
  if (!origin) throw new Error('Informe o servidor: pnpm companion --server https://seu-servidor:18766');
  return { origin: companionOrigin(origin), certificate };
}
