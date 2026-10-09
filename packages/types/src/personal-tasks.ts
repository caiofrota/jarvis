import { z } from "zod";
export const personalTaskSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    text: z.string().trim().min(1).max(180),
    done: z.boolean(),
  })
  .strict();
export const personalTaskListSchema = z
  .array(personalTaskSchema)
  .max(100)
  .refine(
    (tasks) => new Set(tasks.map((task) => task.id)).size === tasks.length,
    "A lista tem identificadores repetidos.",
  );
export const personalTaskStatusSchema = z
  .object({ tasks: personalTaskListSchema, revision: z.string().uuid().nullable() })
  .strict();
export const personalTaskSaveSchema = personalTaskStatusSchema;
export const personalTaskImportSchema = z.object({ tasks: personalTaskListSchema }).strict();
export const personalTaskOperationSchema = z
  .object({
    operation: z.enum(["list", "add", "check", "update", "complete"]),
    id: z.string().max(100).nullable(),
    title: z.string().trim().min(1).max(180).nullable(),
    expectedTitle: z.string().max(180).nullable(),
  })
  .strict();
export type PersonalTaskStatus = z.infer<typeof personalTaskStatusSchema>;
