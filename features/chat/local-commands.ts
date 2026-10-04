import type { Task, TaskReceipt } from '../../shared/types';
export type LocalReply = string | { type: 'task-result'; text: string; receipt: TaskReceipt } | null;
interface Context {
  tasks: Task[];
  addTask(title: string): { text: string; receipt: TaskReceipt };
  focus(): void;
}
export function localCommand(text: string, { tasks, addTask, focus }: Context): LocalReply {
  const normalized = text
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (/^criar tarefa\s*:/.test(normalized)) {
    const title = text.slice(text.indexOf(':') + 1).trim();
    if (!title) return 'Escreva o título depois de “criar tarefa:”.';
    return { type: 'task-result', ...addTask(title) };
  }
  if (/^(minhas tarefas|o que tenho para fazer\??)$/.test(normalized)) {
    const pending = tasks.filter((task) => !task.done);
    return pending.length
      ? 'Suas tarefas pendentes:\n' + pending.map((task) => '• ' + task.text).join('\n')
      : 'Você ainda não tem tarefas pendentes.';
  }
  if (/^(foco|modo foco)$/.test(normalized)) {
    focus();
    return 'Modo foco ativado. Use Visão geral para voltar.';
  }
  return null;
}
