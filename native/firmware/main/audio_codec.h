#pragma once
#include <algorithm>
#include <cstddef>
#include <cstdint>

namespace audio_codec {
struct State {
  int predictor = 0;
  int index = 0;
};
inline constexpr int steps[] = {
    7,     8,     9,     10,    11,    12,    13,    14,    16,    17,
    19,    21,    23,    25,    28,    31,    34,    37,    41,    45,
    50,    55,    60,    66,    73,    80,    88,    97,    107,   118,
    130,   143,   157,   173,   190,   209,   230,   253,   279,   307,
    337,   371,   408,   449,   494,   544,   598,   658,   724,   796,
    876,   963,   1060,  1166,  1282,  1411,  1552,  1707,  1878,  2066,
    2272,  2499,  2749,  3024,  3327,  3660,  4026,  4428,  4871,  5358,
    5894,  6484,  7132,  7845,  8630,  9493,  10442, 11487, 12635, 13899,
    15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767};
inline constexpr int indices[] = {-1, -1, -1, -1, 2, 4, 6, 8};
inline void advance(int code, State &state) {
  int step = steps[state.index], delta = step >> 3;
  if (code & 4)
    delta += step;
  if (code & 2)
    delta += step >> 1;
  if (code & 1)
    delta += step >> 2;
  state.predictor = std::clamp(state.predictor + ((code & 8) ? -delta : delta),
                               -32768, 32767);
  state.index = std::clamp(state.index + indices[code & 7], 0, 88);
}
inline size_t encode(const int16_t *pcm, size_t count, uint8_t *out,
                     State &state) {
  if (!count || count > 320)
    return 0;
  out[0] = count & 255;
  out[1] = count >> 8;
  out[2] = state.predictor & 255;
  out[3] = (uint16_t)state.predictor >> 8;
  out[4] = state.index;
  for (size_t i = 0; i < count; i++) {
    int delta = int(pcm[i]) - state.predictor;
    int code = delta < 0 ? 8 : 0;
    if (delta < 0)
      delta = -delta;
    int threshold = steps[state.index];
    for (int bit : {4, 2, 1}) {
      if (delta >= threshold) {
        code |= bit;
        delta -= threshold;
      }
      threshold >>= 1;
    }
    advance(code, state);
    if (i % 2 == 0)
      out[5 + i / 2] = code << 4;
    else
      out[5 + i / 2] |= code;
  }
  return 5 + (count + 1) / 2;
}
inline size_t decode(const uint8_t *packet, size_t size, int16_t *out) {
  if (size < 6)
    return 0;
  size_t count = packet[0] | (uint16_t(packet[1]) << 8);
  State state{int16_t(packet[2] | (uint16_t(packet[3]) << 8)), packet[4]};
  if (!count || count > 320 || state.index > 88 || size != 5 + (count + 1) / 2)
    return 0;
  for (size_t i = 0; i < count; i++) {
    int code = (packet[5 + i / 2] >> (i % 2 ? 0 : 4)) & 15;
    advance(code, state);
    out[i] = state.predictor;
  }
  return count;
}
} // namespace audio_codec
