#pragma once
#include "robot.h"
#include <algorithm>
#include <cmath>

struct RestPose {
  bool sleepy;
  bool yawning;
};
inline RestPose rest_pose(Mode state, int64_t elapsed_us) {
  // The server owns the timeout. Keep the visual state aligned with capture
  // while an utterance that began before the deadline is still arriving.
  bool sleepy = state == Mode::drowsy;
  int64_t phase = elapsed_us % 25000000;
  return {sleepy, sleepy && phase >= 2000000 && phase < 4500000};
}
inline int thinking_shift(int64_t elapsed_us) {
  return std::lround(4.0 *
                     std::sin((elapsed_us % 3200000) * 6.2831853 / 3200000));
}

// The same pixel renderer is used on the OLED and by the desktop preview tool.
struct FaceArt {
  uint8_t (&screen)[1024];
  int offset = 0;
  int gaze = 0;
  void pixel(int x, int y) {
    x += offset;
    if (x >= 0 && x < 128 && y >= 0 && y < 64)
      screen[x + (y / 8) * 128] |= 1 << (y % 8);
  }
  void rect(int x, int y, int w, int h) {
    for (int j = y; j < y + h; j++)
      for (int i = x; i < x + w; i++)
        pixel(i, j);
  }
  bool rounded_pixel(int dx, int dy, int rx, int ry, int radius) {
    int cx = std::max(0, std::abs(dx) - (rx - radius));
    int cy = std::max(0, std::abs(dy) - (ry - radius));
    return cx * cx + cy * cy <= radius * radius;
  }
  void rounded(int x, int y, int rx, int ry, int radius) {
    for (int dy = -ry; dy <= ry; dy++)
      for (int dx = -rx; dx <= rx; dx++)
        if (rounded_pixel(dx, dy, rx, ry, radius))
          pixel(x + dx, y + dy);
  }
  void eye(int x, bool left, Expression feeling) {
    if (feeling == Expression::happy) {
      for (int dx = -11; dx <= 11; dx++)
        rect(x + dx, 23 + dx * dx / 23, 1, 3);
    } else if (feeling == Expression::sad || feeling == Expression::angry) {
      for (int dx = -11; dx <= 11; dx++) {
        int nose = left ? dx : -dx;
        int top = feeling == Expression::angry ? 23 + nose / 3 : 26 - nose / 4;
        for (int dy = -9; dy <= 9; dy++)
          if (rounded_pixel(dx, dy, 11, 9, 5) && 27 + dy >= top)
            pixel(x + dx, 27 + dy);
        int brow = feeling == Expression::angry ? 17 + nose / 3 : 18 - nose / 4;
        rect(x + dx, brow, 1, 2);
      }
    } else if (feeling == Expression::surprised) {
      rounded(x, 28, 9, 12, 6);
      rect(x - 8, 12, 16, 2);
    } else if (feeling == Expression::curious) {
      // Both eyes are open and attentive; asymmetry belongs to confusion.
      rounded(x + 2 + gaze, 27, 10, 11, 6);
      for (int dx = -8; dx <= 8; dx++)
        rect(x + 2 + gaze + dx, 11 + dx * dx / 48, 1, 2);
    } else if (feeling == Expression::confused) {
      rounded(x, left ? 25 : 28, 11, left ? 10 : 7, 5);
      if (left)
        for (int dx = -10; dx <= 10; dx++)
          rect(x + dx, 12 + dx * dx / 40, 1, 2);
    } else if (feeling == Expression::excited) {
      rounded(x, 27, 11, 12, 6);
      int star = left ? x - 20 : x + 20;
      for (int d = -3; d <= 3; d++) {
        pixel(star + d, 20);
        pixel(star, 20 + d);
      }
    } else if (feeling == Expression::shy) {
      rounded(x - 4 + gaze / 2, 29, 8, 7, 5);
      for (int stripe = 0; stripe < 3; stripe++)
        for (int d = 0; d < 4; d++)
          pixel(x - 8 + stripe * 5 + d / 2, 44 - d);
    } else if (feeling == Expression::skeptical) {
      rounded(x + 3, 29, 11, left ? 3 : 5, 3);
      rect(x - 9, left ? 19 : 16, 19, 2);
    } else if (feeling == Expression::proud) {
      for (int dx = -11; dx <= 11; dx++)
        rect(x + dx, 25 + dx * dx / 42, 1, 3);
      rect(x - 7, 18, 15, 2);
    } else if (feeling == Expression::affectionate) {
      for (int dx = -10; dx <= 10; dx++)
        rect(x + dx, 26 + dx * dx / 28, 1, 2);
      rounded(x - 9, 39, 4, 1, 1);
    } else
      rounded(x, 27, 11, 9, 6);
  }
  void sleep_marks() {
    for (int i = 0; i < 3; i++) {
      int x = 105 + i * 7, y = 27 - i * 7;
      rect(x, y, 5, 1);
      rect(x, y + 4, 5, 1);
      for (int d = 1; d < 4; d++)
        pixel(x + 4 - d, y + d);
    }
  }
  void draw(Mode state, Expression feeling, bool sleepy, bool blink, bool yawn,
            int mouth_level, bool portal = false, int shift = 0) {
    offset = state == Mode::thinking && !portal ? std::clamp(shift, -4, 4) : 0;
    gaze = state == Mode::speaking ? std::clamp(shift, -2, 2) : 0;
    bool asleep = (state == Mode::idle && !sleepy) || state == Mode::muted ||
                  state == Mode::offline;
    for (int x : {36, 84}) {
      if (asleep || blink)
        rect(x - 11, 28, 23, 2);
      else if (sleepy) {
        // Half-closed lids have a flat top and rounded lower corners.
        for (int dx = -11; dx <= 11; dx++)
          for (int dy = 0; dy <= 9; dy++)
            if (rounded_pixel(dx, dy, 11, 9, 5))
              pixel(x + dx, 26 + dy);
      } else if (state == Mode::thinking) {
        // Keep the eyes at normal height as the whole face sways sideways.
        rounded(x, 27, 11, 9, 6);
      } else if (state == Mode::speaking)
        eye(x, x == 36, feeling);
      else
        rounded(x, 27, 12, 11, 6);
    }
    if (state == Mode::idle && !sleepy && !portal)
      sleep_marks();
    if (portal)
      return;
    if (state == Mode::speaking) {
      int opening = std::clamp(mouth_level, 0, 8);
      if (opening > 0) {
        for (int x = 51; x <= 73; x++) {
          float dx = (x - 62) / 11.0f;
          float curve = std::sqrt(std::max(0.0f, 1.0f - dx * dx));
          int top = 48 - int(2 * curve);
          int bottom = 48 + int((opening + 1) * curve);
          rect(x, top, 1, bottom - top + 2);
        }
      } else if (feeling == Expression::confused ||
                 feeling == Expression::skeptical) {
        for (int dx = -7; dx <= 7; dx++)
          rect(62 + dx, 50 + dx / 4, 1, 2);
      } else if (feeling == Expression::curious ||
                 feeling == Expression::happy || feeling == Expression::proud ||
                 feeling == Expression::affectionate ||
                 feeling == Expression::shy || feeling == Expression::excited) {
        int width = feeling == Expression::shy ? 6 : 9;
        for (int dx = -width; dx <= width; dx++)
          rect(62 + dx, 51 - dx * dx / 28, 1, 2);
      } else
        rect(53, 50, 19, 2);
    } else if (sleepy && yawn) {
      rounded(62, 50, 6, 8, 5);
    } else if (state == Mode::thinking) {
      rect(57, 48, 11, 2);
    } else
      rect(53, 50, 19, 2);
  }
};
