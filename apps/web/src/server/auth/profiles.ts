import { randomUUID } from "node:crypto";
import { json, type Repository } from "@rosie/db";
import {
  type Account,
  type PersonalProfileStatus,
  personalProfileSchema,
  savePersonalProfileSchema,
  schemas,
} from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import { z } from "zod";

const savedSchema = z.object({ profile: personalProfileSchema, revision: z.string().uuid() });
const key = (owner: string) => `user-profile:${owner}`;
export class PersonalProfiles {
  constructor(private readonly repo: Repository) {}
  async get(owner: string): Promise<PersonalProfileStatus> {
    const user = await this.repo.db.user.findUnique({ where: { id: owner } });
    if (!user?.enabled) throw new DomainError("Conta indisponível.");
    const row = await this.repo.db.setting.findUnique({ where: { id: key(owner) } });
    if (!row) return { profile: personalProfileSchema.parse({}), revision: null };
    return savedSchema.parse(row.data);
  }
  async save(actor: Account, input: unknown): Promise<PersonalProfileStatus> {
    const parsed = savePersonalProfileSchema.parse(input);
    return this.repo.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: actor.id } });
      if (!user?.enabled) throw new DomainError("Conta indisponível.");
      const row = await tx.setting.findUnique({ where: { id: key(actor.id) } });
      const previous = row ? savedSchema.parse(row.data) : null;
      if ((previous?.revision ?? null) !== parsed.revision)
        throw new DomainError("Seu perfil mudou. Recarregue antes de salvar.");
      const next = { profile: parsed.profile, revision: randomUUID() };
      if (next.profile.defaultSharedAssistantId) {
        const assistant = await tx.entry.findUnique({
          where: {
            collection_id: { collection: "assistants", id: next.profile.defaultSharedAssistantId },
          },
        });
        if (!assistant || !schemas.assistants.parse(assistant.data).enabled)
          throw new DomainError("Assistente compartilhado indisponível.");
      }
      await tx.setting.upsert({
        where: { id: key(actor.id) },
        create: { id: key(actor.id), data: json(next) },
        update: { data: json(next) },
      });
      await tx.event.create({
        data: {
          kind: "personal_profile_saved",
          detail: { actor: actor.id, assistants: next.profile.assistants.length },
        },
      });
      return next;
    });
  }
}
