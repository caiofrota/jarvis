import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Repository } from "@rosie/db";
import { type Account, type Actor, usernameSchema } from "@rosie/types";
import { getIronSession } from "iron-session";
import type { AppConfig } from "../config";
import { HttpError } from "../http/errors";
import { Accounts, publicAccount } from "./accounts";
import { verifyPassword } from "./password";

const sessionKey = (id: string) => createHash("sha256").update(id).digest("hex");

export class RateLimit {
  private attempts = new Map<string, number[]>();
  check(key: string, limit = 10) {
    const now = Date.now();
    for (const [ip, times] of this.attempts) {
      const recent = times.filter((t) => t > now - 60000);
      if (recent.length) this.attempts.set(ip, recent);
      else this.attempts.delete(ip);
    }
    const times = this.attempts.get(key) ?? [];
    if (times.length >= limit || this.attempts.size > 1000)
      throw new HttpError(429, "Aguarde um minuto antes de tentar novamente.");
    times.push(now);
    this.attempts.set(key, times);
  }
}
export class Authentication {
  readonly limits = new RateLimit();
  readonly accounts: Accounts;
  constructor(
    private repo: Repository,
    private cfg: AppConfig,
  ) {
    this.accounts = new Accounts(repo.db);
  }
  private cookie(req: IncomingMessage, res: ServerResponse) {
    return getIronSession<{ id?: string }>(req, res, {
      cookieName: "rosie-session",
      password: createHash("sha512")
        .update(`rosie:user-session:${this.cfg.adminToken}`)
        .digest("hex"),
      ttl: 28800,
      cookieOptions: {
        httpOnly: true,
        sameSite: "strict",
        secure: this.cfg.origin.startsWith("https:"),
        path: "/",
      },
    });
  }
  checkOrigin(req: IncomingMessage) {
    if (req.headers.origin !== this.cfg.origin) throw new HttpError(403, "Origem não autorizada.");
  }
  async login(req: IncomingMessage, res: ServerResponse, username: unknown, password: unknown) {
    this.limits.check(`login:${req.socket.remoteAddress}`);
    const normalized = usernameSchema.safeParse(username);
    if (!normalized.success || typeof password !== "string" || password.length > 128)
      throw new HttpError(401, "Usuário ou senha incorretos.");
    const user = await this.repo.db.user.findUnique({ where: { username: normalized.data } });
    const valid = await verifyPassword(password, user?.passwordHash);
    if (!valid || !user?.enabled) throw new HttpError(401, "Usuário ou senha incorretos.");
    const session = await this.cookie(req, res);
    const id = randomBytes(32).toString("hex");
    await this.repo.db.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id: user.id } });
      if (!current?.enabled || current.passwordHash !== user.passwordHash)
        throw new HttpError(401, "Usuário ou senha incorretos.");
      if (session.id) await tx.userSession.deleteMany({ where: { id: sessionKey(session.id) } });
      await tx.userSession.create({
        data: { id: sessionKey(id), userId: user.id, expiresAt: new Date(Date.now() + 28800000) },
      });
    });
    session.id = id;
    await session.save();
    await this.repo.db.userSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
  async require(req: IncomingMessage, res: ServerResponse): Promise<Actor> {
    const session = await this.cookie(req, res);
    if (!session.id) throw new HttpError(401, "Entre no painel para continuar.");
    const stored = await this.repo.db.userSession.findUnique({
      where: { id: sessionKey(session.id) },
      include: { user: { select: publicAccount } },
    });
    if (!stored || stored.expiresAt <= new Date() || !stored.user.enabled) {
      session.destroy();
      throw new HttpError(401, "Sua sessão expirou.");
    }
    return {
      user: stored.user as Account,
      capabilities:
        stored.user.role === "admin"
          ? [
              "catalog.read",
              "status.read",
              "catalog.manage",
              "robot.control",
              "settings.manage",
              "users.manage",
            ]
          : ["catalog.read", "status.read"],
    };
  }
  async logout(req: IncomingMessage, res: ServerResponse) {
    const session = await this.cookie(req, res);
    if (session.id)
      await this.repo.db.userSession.deleteMany({ where: { id: sessionKey(session.id) } });
    session.destroy();
  }
}
