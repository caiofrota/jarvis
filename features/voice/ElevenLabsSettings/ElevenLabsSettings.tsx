import { useEffect, useId, useState } from 'react';
import { getAPI } from '../../../client/api';
import type { SpeechController } from '../../controllers';

export default function ElevenLabsSettings({ speech, busy }: { speech: SpeechController; busy: boolean }) {
  const id = useId();
  const [key, setKey] = useState(''),
    [configured, setConfigured] = useState(false);
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true;
    getAPI()
      .elevenLabsStatus()
      .then((status) => {
        if (alive) setConfigured(status.configured);
      })
      .catch((cause: Error) => {
        if (alive) setMessage(cause.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function refresh() {
    setLoading(true);
    setMessage('');
    try {
      setVoices(await getAPI().elevenLabsVoices());
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }
  async function connect(value: string) {
    setLoading(true);
    setMessage('');
    try {
      const status = await getAPI().setElevenLabsKey(value);
      setConfigured(status.configured);
      setKey('');
      setVoices([]);
      setMessage(
        status.configured
          ? 'Chave salva. Atualize as vozes para consultar sua conta.'
          : 'Chave desconectada.',
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }
  const disabled = busy || speech.busy || loading;
  return (
    <div className="cloud-key">
      <label htmlFor={id}>Chave da API ElevenLabs</label>
      <div className="key-row">
        <input
          id={id}
          type="password"
          autoComplete="off"
          value={key}
          disabled={disabled}
          onChange={(event) => setKey(event.target.value)}
          placeholder={configured ? 'Chave salva' : 'Insira sua chave'}
        />
        <button className="button" disabled={disabled || !key.trim()} onClick={() => void connect(key)}>
          Conectar
        </button>
        <button className="button" disabled={disabled || !configured} onClick={() => void connect('')}>
          Desconectar
        </button>
      </div>
      <p className="voice-disclosure">
        Desktop: chave protegida pelo sistema. Navegador: somente nesta sessão do servidor. Áudio e texto
        podem ser retidos pela ElevenLabs.
      </p>
      {speech.options.mode === 'elevenlabs' && (
        <label className="setting-row">
          <strong>Voz ElevenLabs</strong>
          <select
            aria-label="Voz ElevenLabs"
            value={speech.options.elevenLabsVoice || ''}
            disabled={disabled}
            onChange={(event) => {
              speech.stop();
              speech.setOptions({ ...speech.options, elevenLabsVoice: event.target.value });
            }}
          >
            <option value="">Escolha uma voz da sua conta</option>
            {speech.options.elevenLabsVoice &&
              !voices.some((voice) => voice.id === speech.options.elevenLabsVoice) && (
                <option value={speech.options.elevenLabsVoice}>Voz salva · atualize o catálogo</option>
              )}
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button className="button" disabled={disabled || !configured} onClick={() => void refresh()}>
        {loading ? 'Aguarde…' : 'Atualizar vozes'}
      </button>
      <p className="connection-status" role="status">
        {message}
      </p>
    </div>
  );
}
