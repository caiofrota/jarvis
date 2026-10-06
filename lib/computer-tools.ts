export type Decision =
  | { type: 'reply'; text: string }
  | { type: 'add-task'; title: string }
  | { type: 'update-task'; id: string; title: string }
  | { type: 'check-task'; title: string }
  | { type: 'complete-task'; id: string }
  | { type: 'open-target'; name: string };
export function validateTool(call: { name?: unknown; arguments?: unknown }): Decision {
  const raw = call.arguments;
  const args: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Ação inválida.');
  const data = args as Record<string, unknown>;
  if (Object.keys(data).length !== (call.name === 'update_task' ? 2 : 1))
    throw new Error('Argumentos inválidos.');
  if (call.name === 'open_computer_target') {
    if (typeof data.target !== 'string' || !data.target.trim() || data.target.length > 150)
      throw new Error('Nome do aplicativo inválido.');
    return { type: 'open-target', name: data.target.trim() };
  }
  if (call.name === 'complete_task') {
    if (typeof data.id !== 'string' || !data.id.trim() || data.id.length > 100)
      throw new Error('Identificador de tarefa inválido.');
    return { type: 'complete-task', id: data.id };
  }
  if (call.name === 'add_task' || call.name === 'update_task' || call.name === 'check_task') {
    const title =
      typeof data.title === 'string'
        ? data.title
            .trim()
            .replace(/[.!?]+$/, '')
            .trim()
        : '';
    if (!title || title.length > 180) throw new Error('O título da tarefa é inválido.');
    const cleaned = title[0].toLocaleUpperCase('pt-BR') + title.slice(1);
    if (call.name === 'update_task') {
      if (typeof data.id !== 'string' || !data.id.trim() || data.id.length > 100)
        throw new Error('Identificador de tarefa inválido.');
      return { type: 'update-task', id: data.id, title: cleaned };
    }
    return { type: call.name === 'check_task' ? 'check-task' : 'add-task', title: cleaned };
  }
  throw new Error('Ação desconhecida.');
}
