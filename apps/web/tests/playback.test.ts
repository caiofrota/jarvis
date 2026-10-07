import { expect, it } from "vitest";
import type WebSocket from "ws";
import { decodeBatch, encode } from "../src/server/robot/codec";
import { Playback } from "../src/server/robot/playback";

it("matches the independent CPython audioop golden vector", () => {
  const pcm = Buffer.alloc(32);
  [
    0, 0, 100, -100, 1000, -1000, 16000, -16000, 32767, -32768, 0, 0, 200, -200, 10000, -10000,
  ].forEach((v, i) => {
    pcm.writeInt16LE(v, i * 2);
  });
  const packet = encode(pcm, { predictor: 0, index: 0 });
  expect(packet.subarray(5).toString("hex")).toBe("007f7f7f7f28087f");
  const decoded = decodeBatch(packet, 5);
  expect(Array.from({ length: 16 }, (_, i) => decoded.readInt16LE(i * 2))).toEqual([
    0, 0, 11, -19, 44, -92, 201, -430, 927, -1983, 95, -283, 60, -252, 4008, -5123,
  ]);
  expect(() => decodeBatch(packet.subarray(1), 5)).toThrow();
});
it("sends continuous batched playback within credit and ignores stale acknowledgements", async () => {
  let player: Playback,
    received = 0,
    maxAhead = 0;
  const socket = {
    send(data: string | Buffer, done: (error?: Error) => void) {
      if (Buffer.isBuffer(data)) {
        received += decodeBatch(data, 5).length;
        maxAhead = Math.max(maxAhead, received - player.played);
        setTimeout(() => player.acknowledge({ type: "played", id: player.id, bytes: received }), 1);
      } else {
        const message = JSON.parse(data);
        if (message.type === "play_end")
          setTimeout(
            () => player.acknowledge({ type: "play_done", id: message.id, bytes: received }),
            5,
          );
      }
      done();
    },
  } as WebSocket;
  player = new Playback(socket);
  const result = await player.play(Buffer.alloc(32000 * 5), 5, true, AbortSignal.timeout(2000));
  expect(received).toBe(160000);
  expect(maxAhead).toBeLessThanOrEqual(76800);
  expect(result.bytes).toBe(160000);
  player.acknowledge({ type: "played", id: "old", bytes: 999999 });
  expect(() => player.acknowledge({ type: "played", id: player.id, bytes: 999999 })).toThrow();
});
it("cancels instead of waiting for a missing speaker acknowledgement", async () => {
  const socket = {
    send(_data: unknown, done: () => void) {
      done();
    },
  } as WebSocket;
  const player = new Playback(socket);
  await expect(
    player.play(Buffer.alloc(32000 * 10), 5, true, AbortSignal.timeout(30)),
  ).rejects.toThrow();
});
