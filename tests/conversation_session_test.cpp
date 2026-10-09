#include "conversation_session.h"

#include <cassert>
#include <iostream>
#include <limits>

using desk_robot::ConversationSession;

int main() {
  constexpr uint32_t timeout = 30000;
  ConversationSession session;
  session.wait_for_reply(0);
  assert(!session.active());
  assert(!session.expired(60000, timeout));

  session.begin();
  session.wait_for_reply(0);
  assert(!session.expired(29999, timeout));
  assert(session.expired(30000, timeout));

  // Speaking and a long answer must not consume the next reply window.
  session.speech_started();
  assert(!session.expired(60000, timeout));
  session.text_accepted();
  session.response_started();
  assert(!session.expired(120000, timeout));
  session.wait_for_reply(120000);
  assert(!session.expired(149999, timeout));
  assert(session.expired(150000, timeout));

  // Retried STT with no recognized text keeps the original deadline.
  session.close();
  session.begin();
  session.wait_for_reply(1000);
  session.speech_started();
  session.no_text();
  session.wait_for_reply(20000);
  assert(!session.expired(30999, timeout));
  assert(session.expired(31000, timeout));

  // Late speech/playback events cannot reopen a closed session.
  session.close();
  session.speech_started();
  session.text_accepted();
  session.response_started();
  session.wait_for_reply(50000);
  assert(!session.active());
  assert(!session.expired(100000, timeout));

  // millis() wraps on the ESP32; the deadline must still expire correctly.
  const uint32_t start = std::numeric_limits<uint32_t>::max() - 10000;
  session.begin();
  session.wait_for_reply(start);
  assert(!session.expired(start + timeout - 1, timeout));
  assert(session.expired(start + timeout, timeout));

  for (const std::string text : {"Pare!", "  PODE, PARAR.  ", "encerrar conversa",
                                 "Encerre a conversa.", "pare de ouvir"}) {
    assert(desk_robot::is_stop_phrase(text));
  }
  for (const std::string text : {"", "nao pare", "não pare", "pare a música",
                                 "pare o ventilador", "ele disse pare", "compare"}) {
    assert(!desk_robot::is_stop_phrase(text));
  }

  // Closing, reconnecting, or polling after a failed start must not cause a
  // retry storm. Simulate repeated callers while the transport remains blocked.
  desk_robot::VoiceRetryCooldown retry;
  assert(retry.ready(0));
  unsigned attempts = 0;
  for (uint32_t now = 0; now < 30000; ++now) {
    for (unsigned caller = 0; caller < 3; ++caller) {
      if (retry.ready(now)) {
        ++attempts;
        retry.failed(now);
      }
    }
  }
  assert(attempts == 3);
  assert(!retry.ready(29999));
  assert(retry.ready(30000));

  // An ordinary close or an empty transcription does not itself arm cooldown.
  // Once a failed-start cooldown elapses, a successful conversation can proceed.
  assert(retry.ready(30001));
  retry.failed(32000);
  assert(!retry.ready(41999));
  assert(retry.ready(42000));

  desk_robot::VoiceRetryCooldown wrapping_retry;
  const uint32_t retry_start = std::numeric_limits<uint32_t>::max() - 5000;
  wrapping_retry.failed(retry_start);
  assert(!wrapping_retry.ready(retry_start + 9999));
  assert(wrapping_retry.ready(retry_start + 10000));
  std::cout << "Conversation session checks passed\n";
}
