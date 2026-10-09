#pragma once

#include <cstdint>
#include <string>

namespace desk_robot {

// Tracks the user's reply window independently of HA pipeline restarts.
class ConversationSession {
 public:
  void begin() { active_ = true; }
  bool active() const { return active_; }

  void wait_for_reply(uint32_t now) {
    if (!active_) return;
    if (!waiting_) {
      waiting_since_ = now;
      waiting_ = true;
    }
    busy_ = false;
  }

  void speech_started() {
    if (active_) busy_ = true;
  }

  void text_accepted() {
    if (!active_) return;
    waiting_ = false;
    busy_ = true;
  }

  void response_started() {
    if (!active_) return;
    waiting_ = false;
    busy_ = true;
  }

  // Empty recognition must not renew the reply window indefinitely.
  void no_text() { busy_ = false; }

  bool expired(uint32_t now, uint32_t timeout_ms) const {
    return active_ && waiting_ && !busy_ &&
           static_cast<uint32_t>(now - waiting_since_) >= timeout_ms;
  }

  void close() {
    active_ = false;
    waiting_ = false;
    busy_ = false;
  }

 private:
  bool active_{false};
  bool waiting_{false};
  bool busy_{false};
  uint32_t waiting_since_{0};
};

inline ConversationSession conversation_session;

// All script-driven restarts share this cooldown, including reconnect and close.
class VoiceRetryCooldown {
 public:
  void failed(uint32_t now) {
    failed_at_ = now;
    pending_ = true;
  }

  bool ready(uint32_t now) const {
    return !pending_ || static_cast<uint32_t>(now - failed_at_) >= 10000;
  }

 private:
  bool pending_{false};
  uint32_t failed_at_{0};
};

inline VoiceRetryCooldown voice_retry_cooldown;

inline bool is_stop_phrase(const std::string &text) {
  std::string normalized;
  bool separator = false;
  for (unsigned char c : text) {
    if (c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '.' ||
        c == ',' || c == '!' || c == '?' || c == ';' || c == ':') {
      separator = !normalized.empty();
      continue;
    }
    if (separator) normalized += ' ';
    separator = false;
    normalized += static_cast<char>((c >= 'A' && c <= 'Z') ? c + ('a' - 'A') : c);
  }
  // Match whole utterances so household commands containing "pare" still work.
  return normalized == "pare" || normalized == "pode parar" ||
         normalized == "encerrar conversa" || normalized == "encerrar a conversa" ||
         normalized == "encerre a conversa" || normalized == "parar de ouvir" ||
         normalized == "pare de ouvir";
}

}  // namespace desk_robot
