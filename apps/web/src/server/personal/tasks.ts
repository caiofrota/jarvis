import { randomUUID } from "node:crypto";
import { json, type Repository } from "@rosie/db";
import {
  type PersonalTaskStatus,
  personalTaskImportSchema,
  personalTaskOperationSchema,
  personalTaskSaveSchema,
  personalTaskStatusSchema,
} from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import { taskTitleKey } from "../../../../../shared/task-title";

const key = (owner: string) => `user-tasks:${owner}`;
export class PersonalTasks {
  constructor(private readonly repo: Repository) {}
  async get(owner: string): Promise<PersonalTaskStatus> {
    const user = await this.repo.db.user.findUnique({ where: { id: owner } });
    if (!user?.enabled) throw new DomainError("Conta indisponível.");
    const row = await this.repo.db.setting.findUnique({ where: { id: key(owner) } });
    return row ? personalTaskStatusSchema.parse(row.data) : { tasks: [], revision: null };
  }
  private async change(owner: string, apply: (current: PersonalTaskStatus) => string) {
    return this.repo.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: owner } });
      if (!user?.enabled) throw new DomainError("Conta indisponível.");
      const row = await tx.setting.findUnique({ where: { id: key(owner) } });
      const current = row
        ? personalTaskStatusSchema.parse(row.data)
        : { tasks: [], revision: null };
      const text = apply(current);
      const next = personalTaskStatusSchema.parse({ ...current, revision: randomUUID() });
      await tx.setting.upsert({
        where: { id: key(owner) },
        create: { id: key(owner), data: json(next) },
        update: { data: json(next) },
      });
      return { ...next, text };
    });
  }
  async save(owner: string, raw: unknown) {
    const input = personalTaskSaveSchema.parse(raw);
    const { tasks, revision } = await this.change(owner, (current) => {
      if (current.revision !== input.revision)
        throw new DomainError("Sua lista mudou. Recarregue antes de salvar.");
      current.tasks = input.tasks;
      return "Lista salva.";
    });
    return { tasks, revision };
  }
  async import(owner: string, raw: unknown) {
    const input = personalTaskImportSchema.parse(raw);
    const { tasks, revision } = await this.change(owner, (current) => {
      for (const task of input.tasks)
        if (
          !current.tasks.some(
            (existing) =>
              existing.id === task.id || taskTitleKey(existing.text) === taskTitleKey(task.text),
          )
        )
          current.tasks.push(task);
      return "Lista importada.";
    });
    return { tasks, revision };
  }
  async execute(owner: string, raw: unknown) {
    const input = personalTaskOperationSchema.parse(raw);
    if (input.operation === "list" || input.operation === "check") {
      const current = await this.get(owner);
      const found =
        input.operation === "list"
          ? current.tasks
          : current.tasks.filter((task) =>
              input.id
                ? task.id === input.id
                : input.title && taskTitleKey(task.text) === taskTitleKey(input.title),
            );
      if (input.operation === "check" && found.length > 1)
        throw new DomainError("Há mais de uma tarefa com esse nome. Qual delas?");
      return {
        text: found.length
          ? found.map((task) => `${task.done ? "Concluída" : "Pendente"}: ${task.text}`).join("\n")
          : "Não há tarefas correspondentes na sua lista.",
        changed: false,
      };
    }
    const result = await this.change(owner, (current) => {
      if (input.operation === "add") {
        if (!input.title) throw new DomainError("Diga o título da tarefa.");
        const existing = current.tasks.find(
          (task) => taskTitleKey(task.text) === taskTitleKey(input.title ?? ""),
        );
        if (existing)
          return `A tarefa já existe e está ${existing.done ? "concluída" : "pendente"}: ${existing.text}.`;
        current.tasks.push({ id: randomUUID(), text: input.title, done: false });
        return `Adicionei à sua lista: ${input.title}.`;
      }
      const task = current.tasks.find((task) => task.id === input.id);
      if (!task || task.text !== input.expectedTitle)
        throw new DomainError("A tarefa mudou ou não existe. Consulte a lista novamente.");
      if (input.operation === "complete") {
        task.done = true;
        return `Tarefa concluída: ${task.text}.`;
      }
      if (!input.title) throw new DomainError("Diga o novo título.");
      if (
        current.tasks.some(
          (other) =>
            other.id !== task.id && taskTitleKey(other.text) === taskTitleKey(input.title ?? ""),
        )
      )
        throw new DomainError("Já existe outra tarefa com esse título.");
      task.text = input.title;
      return `Tarefa atualizada: ${task.text}.`;
    });
    return { text: result.text, changed: true };
  }
}
export const personalTaskTool = {
  type: "function",
  function: {
    name: "manage_tasks",
    description:
      "Consulta ou altera a lista pessoal persistida. Use apenas para pedidos atuais e explícitos, nunca hipóteses ou negações. Para corrigir/concluir use o ID e expectedTitle EXATOS da lista atual. Ambiguidade exige pergunta. Nunca confirme uma alteração antes do resultado.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["list", "add", "check", "update", "complete"] },
        id: { type: ["string", "null"] },
        title: { type: ["string", "null"] },
        expectedTitle: { type: ["string", "null"] },
      },
      required: ["operation", "id", "title", "expectedTitle"],
      additionalProperties: false,
    },
  },
};
