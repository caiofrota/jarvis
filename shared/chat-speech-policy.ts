import type { Message } from './types';

function shouldSpeakChatResponse(spoken: boolean, status: Message['status']) {
  return spoken && status === 'done';
}

export { shouldSpeakChatResponse };
