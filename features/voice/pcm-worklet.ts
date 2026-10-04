declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;
class JarvisPCM extends AudioWorkletProcessor {
  private buffer = new Float32Array(2048);
  private offset = 0;
  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => {
      if (event.data === 'flush') {
        if (this.offset) this.port.postMessage(this.buffer.slice(0, this.offset));
        this.offset = 0;
        this.port.postMessage('flushed');
      }
    };
  }
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (input)
      for (const value of input) {
        this.buffer[this.offset++] = value;
        if (this.offset === this.buffer.length) {
          this.port.postMessage(this.buffer.slice());
          this.offset = 0;
        }
      }
    return true;
  }
}
registerProcessor('jarvis-pcm', JarvisPCM);
