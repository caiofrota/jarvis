import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { HttpError } from "../http/errors";

// OWASP's 32 MiB scrypt profile; the bounded work keeps the speech host responsive.
const profile = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
let active = 0;
function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (active >= 2) throw new HttpError(429, "Aguarde alguns segundos antes de tentar novamente.");
  active++;
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 32, profile, (error, key) => {
      active--;
      if (error) reject(error);
      else resolve(key);
    }),
  );
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16),
    key = await derive(password, salt);
  return `scrypt$32768$8$3$${salt.toString("hex")}$${key.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded?: string) {
  const match = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(encoded ?? "");
  // Unknown and disabled accounts perform the same expensive verification.
  const salt = match ? Buffer.from(match[1], "hex") : Buffer.alloc(16);
  const expected = match ? Buffer.from(match[2], "hex") : Buffer.alloc(32);
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected) && Boolean(match);
}
