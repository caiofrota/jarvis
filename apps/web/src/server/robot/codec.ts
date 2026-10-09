const steps = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73,
  80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
  544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499,
  2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487,
  12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const indices = [-1, -1, -1, -1, 2, 4, 6, 8];
export type CodecState = { predictor: number; index: number };
function advance(code: number, s: CodecState) {
  const step = steps[s.index];
  let delta = step >> 3;
  if (code & 4) delta += step;
  if (code & 2) delta += step >> 1;
  if (code & 1) delta += step >> 2;
  s.predictor = Math.max(-32768, Math.min(32767, s.predictor + (code & 8 ? -delta : delta)));
  s.index = Math.max(0, Math.min(88, s.index + indices[code & 7]));
}
export function encode(pcm: Buffer, state: CodecState): Buffer {
  const count = pcm.length / 2;
  if (!Number.isInteger(count) || count < 1 || count > 320) throw new Error("Invalid PCM block");
  const packet = Buffer.alloc(5 + Math.ceil(count / 2));
  packet.writeUInt16LE(count);
  packet.writeInt16LE(state.predictor, 2);
  packet[4] = state.index;
  for (let i = 0; i < count; i++) {
    let delta = pcm.readInt16LE(i * 2) - state.predictor;
    let code = delta < 0 ? 8 : 0;
    delta = Math.abs(delta);
    const step = steps[state.index];
    for (const [bit, threshold] of [
      [4, step],
      [2, step >> 1],
      [1, step >> 2],
    ])
      if (delta >= threshold) {
        code |= bit;
        delta -= threshold;
      }
    advance(code, state);
    packet[5 + Math.floor(i / 2)] |= code << (i % 2 ? 0 : 4);
  }
  return packet;
}
export function decodeBatch(packet: Buffer, maxFrames = 5): Buffer {
  let offset = 0,
    countFrames = 0;
  const chunks: Buffer[] = [];
  while (offset < packet.length) {
    if (packet.length - offset < 6 || ++countFrames > maxFrames)
      throw new Error("Invalid ADPCM batch");
    const count = packet.readUInt16LE(offset),
      size = 5 + Math.ceil(count / 2),
      state = { predictor: packet.readInt16LE(offset + 2), index: packet[offset + 4] };
    if (count < 1 || count > 320 || state.index > 88 || offset + size > packet.length)
      throw new Error("Invalid ADPCM block");
    const pcm = Buffer.alloc(count * 2);
    for (let i = 0; i < count; i++) {
      const code = (packet[offset + 5 + Math.floor(i / 2)] >> (i % 2 ? 0 : 4)) & 15;
      advance(code, state);
      pcm.writeInt16LE(state.predictor, i * 2);
    }
    chunks.push(pcm);
    offset += size;
  }
  if (!chunks.length) throw new Error("Empty ADPCM batch");
  return Buffer.concat(chunks);
}
export function wav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
