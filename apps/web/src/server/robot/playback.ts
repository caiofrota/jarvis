import { randomBytes } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import type { WebSocket } from "ws";
import { encode } from "./codec";

export class Playback {
  id = "";
  played = 0;
  done = false;
  total = 0;
  constructor(private ws: WebSocket) {}
  acknowledge(event: Record<string, unknown>) {
    if (event.id !== this.id) return;
    const bytes = event.bytes;
    if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 0 || bytes > this.total)
      throw new Error("Invalid playback acknowledgement");
    this.played = Math.max(this.played, bytes);
    if (event.type === "play_done") {
      if (bytes !== this.total) throw new Error("Incomplete playback");
      this.done = true;
    }
  }
  send(data: string | Buffer): Promise<void> {
    return new Promise((resolve, reject) =>
      this.ws.send(data, (error) => (error ? reject(error) : resolve())),
    );
  }
  async play(pcm: Buffer, batch: number, compressed: boolean, signal: AbortSignal) {
    if (!pcm.length || pcm.length % 2 || pcm.length > 32000 * 180)
      throw new Error("Invalid playback audio");
    this.id = randomBytes(6).toString("hex");
    this.played = 0;
    this.done = false;
    this.total = pcm.length;
    const start = Date.now(),
      window = batch === 5 ? 76800 : 20480;
    await this.send(
      JSON.stringify({
        type: "play_start",
        id: this.id,
        bytes: pcm.length,
        sample_rate: 16000,
        audio_codec: compressed ? "ima_adpcm" : "pcm_s16le",
      }),
    );
    const encoder = { predictor: 0, index: 0 };
    for (let offset = 0; offset < pcm.length; ) {
      const end = Math.min(pcm.length, offset + 640 * batch),
        waiting = Date.now();
      while (end - this.played > window) {
        signal.throwIfAborted();
        if (Date.now() - waiting > 8000) throw new Error("Playback credit timeout");
        await pause(10, undefined, { signal });
      }
      signal.throwIfAborted();
      let packet = pcm.subarray(offset, end);
      if (compressed) {
        const parts: Buffer[] = [];
        for (let p = offset; p < end; p += 640)
          parts.push(encode(pcm.subarray(p, Math.min(p + 640, end)), encoder));
        packet = Buffer.concat(parts);
      }
      await this.send(packet);
      offset = end;
    }
    await this.send(JSON.stringify({ type: "play_end", id: this.id }));
    const deadline = Date.now() + 10000;
    while (!this.done) {
      signal.throwIfAborted();
      if (Date.now() > deadline) throw new Error("Playback completion timeout");
      await pause(10, undefined, { signal });
    }
    return {
      bytes: pcm.length,
      audio_seconds: pcm.length / 32000,
      elapsed_seconds: (Date.now() - start) / 1000,
    };
  }
}
