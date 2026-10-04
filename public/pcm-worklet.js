"use strict";
class JarvisPCM extends AudioWorkletProcessor {
    buffer = new Float32Array(2048);
    offset = 0;
    constructor() {
        super();
        this.port.onmessage = (event) => {
            if (event.data === 'flush') {
                if (this.offset)
                    this.port.postMessage(this.buffer.slice(0, this.offset));
                this.offset = 0;
                this.port.postMessage('flushed');
            }
        };
    }
    process(inputs) {
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
