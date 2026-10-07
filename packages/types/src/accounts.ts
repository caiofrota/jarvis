import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use letras, números, ponto, hífen ou sublinhado no usuário.");
export const passwordSchema = z
  .string()
  .min(8, "Use uma senha com pelo menos 8 caracteres.")
  .max(128, "Use até 128 caracteres na senha.");
export const accountSchema = z.object({
  username: usernameSchema,
  name: z.string().trim().min(1, "Informe o nome.").max(100),
  role: z.enum(["admin", "viewer"]),
  enabled: z.boolean(),
});
export const createAccountSchema = accountSchema.extend({ password: passwordSchema });
export const updateAccountSchema = accountSchema.extend({
  revision: z.number().int().positive(),
  password: passwordSchema.optional(),
});
export type Account = z.infer<typeof accountSchema> & { id: string; revision: number };
export type Actor = { user: Account; capabilities: string[] };
export const accountRoleLabels = { admin: "Administrador", viewer: "Somente leitura" };
