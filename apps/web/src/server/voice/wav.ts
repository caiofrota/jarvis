import { DomainError } from "@rosie/types/context";

export const MAX_AUDIO_BYTES = 32000 * 180;

/** Accept only the robot's PCM contract, including completed ffmpeg pipe WAVs. */
export function pcmFromWav(wav: Buffer): Buffer {
  const invalid = () => new DomainError("O Home Assistant retornou áudio em formato inválido.");
  if (
    wav.length < 44 ||
    wav.length > MAX_AUDIO_BYTES + 65536 ||
    wav.toString("ascii", 0, 4) !== "RIFF" ||
    wav.toString("ascii", 8, 12) !== "WAVE"
  )
    throw invalid();
  const size = wav.readUInt32LE(4);
  if (size !== 0xffffffff && size + 8 !== wav.length) throw invalid();
  let format = false;
  let pcm: Buffer | undefined;
  for (let offset = 12; offset < wav.length; ) {
    if (offset + 8 > wav.length) throw invalid();
    const kind = wav.toString("ascii", offset, offset + 4);
    const length = wav.readUInt32LE(offset + 4);
    offset += 8;
    const end = kind === "data" && length === 0xffffffff ? wav.length : offset + length;
    if (end > wav.length) throw invalid();
    if (kind === "fmt ") {
      if (
        format ||
        length < 16 ||
        wav.readUInt16LE(offset) !== 1 ||
        wav.readUInt16LE(offset + 2) !== 1 ||
        wav.readUInt32LE(offset + 4) !== 16000 ||
        wav.readUInt32LE(offset + 8) !== 32000 ||
        wav.readUInt16LE(offset + 12) !== 2 ||
        wav.readUInt16LE(offset + 14) !== 16
      )
        throw invalid();
      format = true;
    } else if (kind === "data") {
      if (!format || pcm || end === offset || (end - offset) % 2 || end - offset > MAX_AUDIO_BYTES)
        throw invalid();
      pcm = wav.subarray(offset, end);
    }
    offset = end + ((end - offset) % 2);
    if (offset > wav.length) throw invalid();
  }
  if (!pcm) throw invalid();
  return Buffer.from(pcm);
}
