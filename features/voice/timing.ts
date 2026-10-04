// Shared timing in milliseconds. Silence is added without trimming recorded or synthesized samples.
export const VOICE_TIMING = {
  // The first samples can be lost while the browser audio graph starts,
  // especially when the output is routed to desktop speakers. Keep a small
  // silent lead inside the first buffer instead of delaying the whole turn.
  playbackReserveMs: 850,
  playbackLeadMs: 220,
  playbackTailMs: 320,
  echoTailMs: 900,
  echoHistoryMs: 12000,
  capturePreRollMs: 240,
  captureEndSilenceMs: 850,
  speechConfirmationMs: 160,
} as const;
