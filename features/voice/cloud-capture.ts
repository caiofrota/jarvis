import type { JarvisAPI } from '../../shared/types';
export function captureCloud(
  stream: MediaStream,
  api: JarvisAPI,
  onText: (text: string) => void,
  onError: (message: string) => void,
) {
  const chunks: Blob[] = [],
    recorder = new MediaRecorder(stream);
  let cancelled = false;
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  recorder.start();
  return {
    cancel() {
      cancelled = true;
      if (recorder.state !== 'inactive') recorder.stop();
      api.cancelVoice().catch(() => {});
    },
    stop() {
      return new Promise<string>((resolve) => {
        recorder.onstop = async () => {
          if (cancelled) {
            resolve('');
            return;
          }
          try {
            const blob = new Blob(chunks, { type: recorder.mimeType }),
              bytes = new Uint8Array(await blob.arrayBuffer());
            let binary = '';
            for (let i = 0; i < bytes.length; i += 32768)
              binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
            const result = await api.transcribe({
              provider: 'cloud',
              consent: true,
              mime: blob.type,
              audio: btoa(binary),
            });
            onText(result.text);
            resolve(result.text);
          } catch (eCause) {
            const e = eCause instanceof Error ? eCause : new Error(String(eCause));
            onError(e.message);
            resolve('');
          }
        };
        if (recorder.state !== 'inactive') recorder.stop();
        else resolve('');
      });
    },
  };
}
