export type Decision =
  | { type: 'reply'; text: string }
  | { type: 'add-task'; title: string }
  | { type: 'open-target'; name: string };
export function validateTool(call: { name?: unknown; arguments?: unknown }): Decision {
  const raw = call.arguments;
  const args: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Ação inválida.');
  const data = args as Record<string, unknown>;
  if (Object.keys(data).length !== 1) throw new Error('Argumentos inválidos.');
  if (call.name === 'open_computer_target') {
    if (typeof data.target !== 'string' || !data.target.trim() || data.target.length > 150)
      throw new Error('Nome do aplicativo inválido.');
    return { type: 'open-target', name: data.target.trim() };
  }
  if (call.name === 'add_task') {
    const title =
      typeof data.title === 'string'
        ? data.title
            .trim()
            .replace(/[.!?]+$/, '')
            .trim()
        : '';
    if (!title || title.length > 180) throw new Error('O título da tarefa é inválido.');
    return { type: 'add-task', title: title[0].toLocaleUpperCase('pt-BR') + title.slice(1) };
  }
  throw new Error('Ação desconhecida.');
}
