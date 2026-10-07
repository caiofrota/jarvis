#pragma once
#include "robot.h"
#include <algorithm>

inline bool display_visible(bool enabled, bool provisioning) {
  return enabled || provisioning;
}

inline int indicator_target(Mode state, bool online, bool provisioning,
                            bool enabled, bool playing, int level,
                            int listening, int minimum, int maximum) {
  if (!enabled || !online || provisioning)
    return 0;
  if (conversation_capture(state))
    return std::clamp(listening, 0, 100);
  if (state != Mode::speaking || !playing)
    return 0;
  maximum = std::clamp(maximum, 0, 100);
  minimum = std::clamp(minimum, 0, maximum);
  return minimum + (maximum - minimum) * std::clamp(level, 0, 11) / 11;
}

class IndicatorEnvelope {
  float brightness_ = 0;

public:
  int duty(int target, bool speaking, int maximum) {
    target = std::clamp(target, 0, 100);
    if (!speaking || target == 0)
      brightness_ = target;
    else {
      const float speed = target > brightness_ ? 0.6f : 0.25f;
      brightness_ += (target - brightness_) * speed;
      brightness_ = std::min(brightness_, float(std::clamp(maximum, 0, 100)));
    }
    return std::clamp(int(brightness_ * 1023.0f / 100.0f + 0.5f), 0, 1023);
  }
};
