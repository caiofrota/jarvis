import * as fs from 'node:fs';
import * as path from 'node:path';
import { safeStorage } from 'electron';

export class SecretStore {
  constructor(private readonly file: string) {}

  read(): string {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(this.file)) return '';
    try {
      return safeStorage.decryptString(fs.readFileSync(this.file)).trim();
    } catch {
      return '';
    }
  }

  write(value: string): void {
    const secret = value.trim();
    if (!secret) {
      try {
        fs.rmSync(this.file, { force: true });
      } catch {
        // A missing file already represents a disconnected key.
      }
      return;
    }
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('O armazenamento seguro do sistema não está disponível nesta sessão.');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp-' + process.pid;
    fs.writeFileSync(temporary, safeStorage.encryptString(secret), { mode: 0o600 });
    fs.rmSync(this.file, { force: true });
    fs.renameSync(temporary, this.file);
  }
}
