import { useEffect, useRef, useState } from 'react';
import type { ChatController } from '../controllers';
import type { OpenDialog } from '../../shared/types';
import type { ReturnTypeVoiceInput } from '../voice/voice-types';
import { withoutEmoji } from '../../client/text';

export default function ConversationTranscript({
  chat,
  voice,
  open,
  visible,
}: {
  chat: ChatController;
  voice: ReturnTypeVoiceInput;
  open: OpenDialog;
  visible: boolean;
}) {
  const [draft, setDraft] = useState('');
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (visible && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [chat.messages, visible]);
  return (
    <div className="conversation-transcript">
      <div className="suggestions">
        <button className="suggestion" onClick={() => chat.send('Minhas tarefas')}>
          O que tenho para fazer? <span>Local ↗</span>
        </button>
      </div>
      {!chat.messages.length && <p className="transcript-empty">Nenhuma mensagem.</p>}
      <div className="messages" ref={log} role="log" aria-label="Conversa">
        {chat.messages.map((m, i) => (
          <div key={i} className={'message ' + m.role + (m.status === 'error' ? ' message-error' : '')}>
            <span className="message-author">{m.role === 'user' ? 'Você' : 'Jarvis'}</span>
            {m.role === 'assistant' ? withoutEmoji(m.text) || 'Preparando a resposta…' : m.text}
          </div>
        ))}
      </div>
      {voice.recording &&
        voice.text &&
        voice.text !== chat.messages.findLast((message) => message.role === 'user')?.text && (
          <p className="live-transcript">
            <span>Transcrevendo</span>
            {voice.text}
          </p>
        )}
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) {
            chat.send(draft);
            setDraft('');
          }
        }}
      >
        <input
          aria-label="Mensagem para Jarvis"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Converse com o Jarvis…"
          maxLength={16000}
          disabled={chat.busy}
        />
        {chat.busy ? (
          <button type="button" className="send stop" aria-label="Parar resposta" onClick={chat.stop}>
            ■
          </button>
        ) : (
          <button className="send" aria-label="Enviar mensagem">
            ↑
          </button>
        )}
      </form>
      <div className="voice-toolbar">
        <button
          className="panel-link"
          disabled={voice.recording || voice.processing}
          onClick={() => open('voice')}
        >
          Ditar mensagem
        </button>
        <button className="panel-link" onClick={() => open('speech')}>
          Ouvir resposta
        </button>
        <button className="panel-link" onClick={() => open('computer')}>
          Ações do PC
        </button>
      </div>
    </div>
  );
}
