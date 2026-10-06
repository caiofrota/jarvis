import type {
  Save,
  Preferences,
  Task,
  TaskReceipt,
  TaskUpdateReceipt,
  TaskCheckReceipt,
  TaskCompleteReceipt,
} from '../../shared/types';
function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function updateTask(
  updatePrefs: Save<Preferences>,
  id: string,
  value: string,
  previousTitle: string,
): { receipt: TaskUpdateReceipt; text: string } {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title || title.length > 180) throw new Error('Informe uma tarefa com até 180 caracteres.');
  const saved = updatePrefs((current) => {
    const task = current.tasks.find((item) => item.id === id);
    if (!task) throw new Error('A tarefa a corrigir não existe mais. Nenhuma alteração foi feita.');
    if (task.text !== previousTitle)
      throw new Error('A tarefa mudou desde o pedido. Confira o título antes de corrigir.');
    if (current.tasks.some((item) => item.id !== id && normalize(item.text) === normalize(title)))
      throw new Error('Já existe outra tarefa com esse título. Qual delas você quer manter?');
    return {
      ...current,
      tasks: current.tasks.map((item) => (item.id === id ? { ...item, text: title } : item)),
    };
  });
  if (!saved?.tasks.some((task) => task.id === id && task.text === title))
    throw new Error('Não consegui salvar a correção. Nenhuma alteração foi confirmada.');
  return {
    receipt: { type: 'update_task', id, title, previousTitle, status: 'updated' },
    text: `Corrigi a tarefa para “${title}”.`,
  };
}

export function checkTask(
  readTasks: () => Task[],
  title: string,
): { receipt: TaskCheckReceipt; text: string } {
  const matches = readTasks().filter((task) => normalize(task.text) === normalize(title));
  if (matches.length > 1)
    throw new Error('Há mais de uma tarefa com esse título. Qual delas você quer verificar?');
  const task = matches[0];
  return task
    ? {
        receipt: { type: 'check_task', title: task.text, id: task.id, done: task.done, status: 'present' },
        text: `“${task.text}” está na sua lista atual${task.done ? ' e já está concluída' : ' como pendente'}.`,
      }
    : {
        receipt: { type: 'check_task', title, status: 'absent' },
        text: `Não encontrei “${title}” na sua lista atual.`,
      };
}

export function completeTask(
  updatePrefs: Save<Preferences>,
  id: string,
  expectedTitle: string,
): { receipt: TaskCompleteReceipt; text: string } {
  let alreadyDone = false;
  const saved = updatePrefs((current) => {
    const task = current.tasks.find((item) => item.id === id);
    if (!task) throw new Error('A tarefa não existe mais. Nada foi concluído.');
    if (task.text !== expectedTitle)
      throw new Error('A tarefa mudou desde o pedido. Confira antes de concluir.');
    alreadyDone = task.done;
    return {
      ...current,
      tasks: current.tasks.map((item) => (item.id === id ? { ...item, done: true } : item)),
    };
  });
  if (!saved?.tasks.some((task) => task.id === id && task.text === expectedTitle && task.done))
    throw new Error('Não consegui salvar a conclusão. Nenhuma conclusão foi confirmada.');
  return {
    receipt: {
      type: 'complete_task',
      id,
      title: expectedTitle,
      status: alreadyDone ? 'already_done' : 'completed',
    },
    text: alreadyDone
      ? `“${expectedTitle}” já está concluída na sua lista.`
      : `Marquei “${expectedTitle}” como concluída.`,
  };
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
