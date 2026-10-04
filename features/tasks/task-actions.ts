import type { Save, Preferences, TaskReceipt } from '../../shared/types';
function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function saveTask(
  updatePrefs: Save<Preferences>,
  value: string,
): { receipt: TaskReceipt; text: string } {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title || title.length > 180) throw new Error('Informe uma tarefa com até 180 caracteres.');
  let receipt: TaskReceipt | undefined;
  const saved = updatePrefs((current) => {
    const existing = current.tasks.find((task) => normalize(task.text) === normalize(title));
    if (existing) {
      receipt = { type: 'add_task', id: existing.id, title: existing.text, status: 'existing' };
      return current;
    }
    if (current.tasks.length >= 100) throw new Error('Seu painel atingiu o limite de 100 tarefas.');
    const task = { id: crypto.randomUUID(), text: title, done: false };
    receipt = { type: 'add_task', id: task.id, title, status: 'saved' };
    return { ...current, tasks: [...current.tasks, task] };
  });
  if (!saved?.tasks.some((task) => task.id === receipt?.id && task.text === receipt?.title))
    throw new Error('Não consegui salvar a tarefa neste navegador. Nenhuma adição foi confirmada.');
  if (!receipt) throw new Error('Gravação sem resultado.');
  return {
    receipt,
    text:
      receipt.status === 'saved'
        ? `Adicionei “${receipt.title}” à sua lista de tarefas.`
        : `“${receipt.title}” já está na sua lista de tarefas.`,
  };
}
