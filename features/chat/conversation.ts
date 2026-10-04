import type { Message, ChatMessage } from '../../shared/types';
export function chatMessages(messages: Message[]): ChatMessage[] {
  return messages
    .filter((message) => !['error', 'cancelled'].includes(message.status))
    .slice(-20)
    .map((message) => {
      const result = message.receipt;
      const content =
        message.role === 'assistant' && result
          ? JSON.stringify({ result, text: message.text })
          : message.text;
      return { role: message.role, content };
    });
}
