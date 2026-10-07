import type { PrismaClient } from "@rosie/db";
import { type Account, createAccountSchema, updateAccountSchema } from "@rosie/types";
import { HttpError } from "../http/errors";
import { hashPassword, verifyPassword } from "./password";

export const publicAccount = {
  id: true,
  username: true,
  name: true,
  role: true,
  enabled: true,
  revision: true,
} as const;
export class Accounts {
  constructor(private db: PrismaClient) {}
  private writes: Promise<unknown> = Promise.resolve();
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.writes.then(task);
    this.writes = result.catch(() => {});
    return result;
  }
  async bootstrap(input: unknown) {
    const data = createAccountSchema.parse(input);
    if (data.role !== "admin" || !data.enabled)
      throw new HttpError(422, "A primeira conta deve ser administradora e ativa.");
    const passwordHash = await hashPassword(data.password);
    return this.db.$transaction(async (tx) => {
      if (
        (await tx.user.count()) ||
        (await tx.setting.findUnique({ where: { id: "user-bootstrap-complete" } }))
      )
        throw new HttpError(409, "O primeiro usuário já existe. Crie os demais pelo painel.");
      const { password: _, ...user } = data;
      const created = await tx.user.create({
        data: { ...user, passwordHash },
        select: publicAccount,
      });
      await tx.setting.create({ data: { id: "user-bootstrap-complete", data: true } });
      await tx.adminSession.deleteMany();
      return created;
    });
  }
  async list(query: URLSearchParams) {
    const page = Number(query.get("page") ?? 1),
      pageSize = Number(query.get("pageSize") ?? 20);
    const sort = query.get("sort") ?? "username",
      direction = query.get("direction") ?? "asc";
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10000 ||
      ![10, 20, 50, 100].includes(pageSize) ||
      !["username", "name", "role", "enabled"].includes(sort) ||
      !["asc", "desc"].includes(direction)
    )
      throw new HttpError(422, "Paginação ou ordenação inválida.");
    const q = (query.get("q") ?? "").trim().slice(0, 100);
    const where = { OR: [{ username: { contains: q } }, { name: { contains: q } }] };
    const [items, total] = await this.db.$transaction([
      this.db.user.findMany({
        where,
        select: publicAccount,
        orderBy: [{ [sort]: direction }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.user.count({ where }),
    ]);
    return { items, total, page, pageSize, sort, direction };
  }
  save(actor: Account, input: unknown, id?: string) {
    const parsed = id ? updateAccountSchema.parse(input) : createAccountSchema.parse(input);
    if (id === actor.id && parsed.password)
      throw new HttpError(
        422,
        "Altere sua própria senha em Minha conta, informando a senha atual.",
      );
    return this.serialize(async () => {
      const passwordHash = parsed.password ? await hashPassword(parsed.password) : undefined;
      return this.db.$transaction(async (tx) => {
        // Revalidate authority inside the write transaction, including queued requests.
        const current = await tx.user.findUnique({ where: { id: actor.id } });
        if (!current?.enabled || current.role !== "admin")
          throw new HttpError(403, "Acesso administrativo necessário.");
        const duplicate = await tx.user.findUnique({ where: { username: parsed.username } });
        if (duplicate && duplicate.id !== id)
          throw new HttpError(409, "Este usuário já está em uso.");
        const old = id ? await tx.user.findUnique({ where: { id } }) : null;
        if (id && (!old || old.revision !== ("revision" in parsed ? parsed.revision : 0)))
          throw new HttpError(409, "Este usuário mudou. Recarregue antes de salvar.");
        if (
          old?.enabled &&
          old.role === "admin" &&
          (!parsed.enabled || parsed.role !== "admin") &&
          (await tx.user.count({ where: { enabled: true, role: "admin" } })) <= 1
        )
          throw new HttpError(409, "Mantenha pelo menos um administrador ativo.");
        if (!id && (await tx.user.count()) >= 100)
          throw new HttpError(409, "Limite de 100 usuários atingido.");
        const data = {
          username: parsed.username,
          name: parsed.name,
          role: parsed.role,
          enabled: parsed.enabled,
        };
        const saved = id
          ? await tx.user.update({
              where: { id },
              data: {
                ...data,
                ...(passwordHash ? { passwordHash } : {}),
                revision: { increment: 1 },
              },
              select: publicAccount,
            })
          : await tx.user.create({
              data: { ...data, passwordHash: passwordHash as string },
              select: publicAccount,
            });
        if (id) await tx.userSession.deleteMany({ where: { userId: id } });
        await tx.event.create({
          data: { kind: "user_saved", detail: { actor: actor.id, user: saved.id } },
        });
        return saved;
      });
    });
  }
  async changePassword(actor: Account, currentPassword: string, password: string) {
    const old = await this.db.user.findUnique({ where: { id: actor.id } });
    if (!old?.enabled || !(await verifyPassword(currentPassword, old.passwordHash)))
      throw new HttpError(401, "Senha atual incorreta.");
    const passwordHash = await hashPassword(password);
    await this.db.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { id: actor.id, enabled: true, passwordHash: old.passwordHash },
        data: { passwordHash, revision: { increment: 1 } },
      });
      if (result.count !== 1) throw new HttpError(409, "Sua conta mudou. Entre novamente.");
      await tx.userSession.deleteMany({ where: { userId: actor.id } });
      await tx.event.create({ data: { kind: "password_changed", detail: { user: actor.id } } });
    });
  }
}
