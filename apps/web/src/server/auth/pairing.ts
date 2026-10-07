import { randomInt } from "node:crypto";
import { HttpError } from "../http/errors";
import { RateLimit } from "./service";
export class Pairing {
  private codes = new Map<string, { id: string; expires: number }>();
  private limits = new RateLimit();
  issue(id: string) {
    for (const [pin, v] of this.codes)
      if (v.expires < Date.now() || v.id === id) this.codes.delete(pin);
    let pin = "";
    do {
      pin = String(randomInt(1000000)).padStart(6, "0");
    } while (this.codes.has(pin));
    this.codes.set(pin, { id, expires: Date.now() + 300000 });
    return { pin, expires_seconds: 300 };
  }
  redeem(pin: unknown, address: string) {
    this.limits.check(address);
    if (typeof pin !== "string" || !/^\d{6}$/.test(pin))
      throw new HttpError(401, "Informe os seis dígitos do PIN.");
    const value = this.codes.get(pin);
    this.codes.delete(pin);
    if (!value || value.expires < Date.now()) throw new HttpError(401, "PIN inválido ou expirado.");
    return value.id;
  }
}
