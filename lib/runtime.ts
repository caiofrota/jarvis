import type { RuntimeInfo } from '../shared/types';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
let cached: RuntimeInfo | undefined;
function runtimeInfo(): RuntimeInfo {
  if (cached) return cached;
  let restricted =
    process.env.CODEX_SANDBOX_NETWORK_DISABLED === '1' || /codex.*sandbox/i.test(os.userInfo().username);
  if (process.platform === 'win32' && !restricted) {
    try {
      const r = spawnSync(
        path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe'),
        ['/groups'],
        { encoding: 'utf8', windowsHide: true, timeout: 2500 },
      );
      restricted = /CodexSandboxUsers/i.test(r.stdout || '');
    } catch {}
  }
  return (cached = {
    restricted,
    platform: process.platform,
    appVersion: '0.4.0',
    message: restricted
      ? 'O servidor está no ambiente protegido do Codex. Para abrir aplicativos na sua área de trabalho, inicie o Jarvis pela pasta do projeto usando Iniciar Jarvis.cmd.'
      : '',
  });
}
export { runtimeInfo };
