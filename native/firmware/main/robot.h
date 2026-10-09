#pragma once
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <string>

enum class Mode {
  idle,
  listening,
  drowsy,
  thinking,
  speaking,
  muted,
  error,
  offline
};
inline bool conversation_capture(Mode state) {
  return state == Mode::listening || state == Mode::drowsy;
}
enum class Expression {
  neutral,
  happy,
  sad,
  angry,
  surprised,
  curious,
  confused,
  excited,
  shy,
  skeptical,
  proud,
  affectionate
};
extern std::atomic<Expression> expression;
extern std::atomic<bool> sleep_now;
extern std::atomic<int> drowsy_seconds;
enum class LinkStatus { wifi, server, pairing, bad_pin, unavailable, ready };
extern std::atomic<LinkStatus> link_status;
extern std::atomic<Mode> mode;
extern std::atomic<int> mouth;
extern std::atomic<int> volume;
extern std::atomic<int> prefill_ms;
extern std::atomic<int64_t> last_activity;
extern std::atomic<bool> connected;
extern std::string portal_pin;
extern std::atomic<bool> portal_active;
extern std::atomic<bool> display_enabled;
void face_init();
void face_task(void *);
void provision_init();
void provision_open();
bool network_ready();
bool provision_pair();
std::string setting(const char *key);
bool wake_init();
bool wake_feed(const int16_t *samples, size_t count);
void wake_reset();
const char *wake_name();
float wake_elapsed_ms();
void send_event(const char *type);
