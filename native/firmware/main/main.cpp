#include "appearance.h"
#include "audio_codec.h"
#include "cJSON.h"
#include "driver/gpio.h"
#include "driver/i2s_std.h"
#include "driver/ledc.h"
#include "esp_crt_bundle.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_websocket_client.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "robot.h"
#include <algorithm>
#include <cmath>
#include <cstring>

std::atomic<Mode> mode{Mode::offline};
std::atomic<Expression> expression{Expression::neutral};
std::atomic<bool> sleep_now{false};
std::atomic<int> drowsy_seconds{60};
std::atomic<int> mouth{0}, volume{70}, prefill_ms{600};
std::atomic<int64_t> last_activity{0};
std::atomic<bool> connected{false};
std::atomic<bool> display_enabled{true};
static std::atomic<bool> led_enabled{false};
static std::atomic<int> led_listening{25}, led_speaking_min{10},
    led_speaking_max{80};
static std::atomic<int> led_duty{0};
static bool led_ready = false;
static std::atomic<bool> reset_wake{false}, play_active{false}, play_end{false},
    cancel_audio{false};
static std::atomic<bool> compressed_audio{false}, compressed_playback{false},
    hello_pending{false}, wake_pending{false}, capture_failed{false};
static esp_websocket_client_handle_t socket_client;
static i2s_chan_handle_t microphone, speaker;
struct Frame {
  uint16_t size;
  int16_t samples[320];
};
// Keep compressed blocks in RAM: 2.56 seconds per queue in roughly 21 KiB.
struct EncodedFrame {
  uint16_t size;
  uint8_t data[165];
};
static constexpr int audio_queue_frames = 128;
static constexpr int audio_send_timeout_ms = 1500;
static std::atomic<int> batch_frames{1};
static std::atomic<unsigned> underruns{0}, upload_peak_ms{0}, send_max_ms{0};
static QueueHandle_t playback, upload;
struct PlaybackProgress {
  char id[32];
  uint32_t bytes;
  bool done;
};
static QueueHandle_t acknowledgements;
static char play_id[32]{};
static std::atomic<uint32_t> playback_total{0};
static bool wake_ready = false;

static void send_json(cJSON *json) {
  char *value = cJSON_PrintUnformatted(json);
  if (connected && value)
    esp_websocket_client_send_text(socket_client, value, strlen(value),
                                   pdMS_TO_TICKS(audio_send_timeout_ms));
  cJSON_free(value);
  cJSON_Delete(json);
}
void send_event(const char *type) {
  auto *j = cJSON_CreateObject();
  cJSON_AddStringToObject(j, "type", type);
  send_json(j);
}
static void progress(const char *type, uint32_t bytes) {
  PlaybackProgress update{};
  strncpy(update.id, play_id, sizeof(update.id) - 1);
  update.bytes = bytes;
  update.done = strcmp(type, "play_done") == 0;
  // Playback must never block on a socket. Coalesce cumulative progress into
  // the latest value; a separate task handles transmission and Wi-Fi jitter.
  xQueueOverwrite(acknowledgements, &update);
}
static void progress_task(void *) {
  PlaybackProgress update{};
  int64_t next_diagnostic = 0;
  while (true) {
    if (hello_pending.exchange(false)) {
      auto *j = cJSON_CreateObject();
      cJSON_AddStringToObject(j, "type", "hello");
      cJSON_AddStringToObject(j, "audio_codec", "ima_adpcm");
      cJSON_AddBoolToObject(j, "drowsy_listening", true);
      cJSON_AddNumberToObject(j, "audio_batch_frames", 5);
      send_json(j);
    }
    if (wake_pending.exchange(false))
      send_event("wake");
    if (capture_failed.exchange(false))
      send_event("capture_error");
    if (xQueueReceive(acknowledgements, &update, pdMS_TO_TICKS(20)) == pdTRUE) {
      auto *j = cJSON_CreateObject();
      cJSON_AddStringToObject(j, "type", update.done ? "play_done" : "played");
      cJSON_AddStringToObject(j, "id", update.id);
      cJSON_AddNumberToObject(j, "bytes", update.bytes);
      send_json(j);
    }
    auto now = esp_timer_get_time();
    if (connected && now > next_diagnostic) {
      next_diagnostic = now + 30000000;
      wifi_ap_record_t ap{};
      esp_wifi_sta_get_ap_info(&ap);
      auto *j = cJSON_CreateObject();
      cJSON_AddStringToObject(j, "type", "diagnostic");
      cJSON_AddStringToObject(j, "wake_model",
                              wake_ready ? wake_name() : "failed");
      cJSON_AddNumberToObject(j, "heap", esp_get_free_heap_size());
      cJSON_AddNumberToObject(j, "wake_ms", wake_elapsed_ms());
      cJSON_AddNumberToObject(j, "rssi", ap.rssi);
      cJSON_AddNumberToObject(j, "underruns", underruns.load());
      cJSON_AddNumberToObject(j, "upload_peak_ms", upload_peak_ms.load());
      cJSON_AddNumberToObject(j, "send_max_ms", send_max_ms.load());
      cJSON_AddNumberToObject(j, "led_duty", led_duty.load());
      cJSON_AddBoolToObject(j, "display_enabled", display_enabled.load());
      send_json(j);
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}
static void state_message(cJSON *json) {
  auto *t = cJSON_GetObjectItem(json, "type");
  if (!cJSON_IsString(t))
    return;
  if (strcmp(t->valuestring, "state") == 0) {
    auto *s = cJSON_GetObjectItem(json, "state");
    if (!cJSON_IsString(s))
      return;
    Mode next = Mode::error;
    if (strcmp(s->valuestring, "idle") == 0)
      next = Mode::idle;
    if (strcmp(s->valuestring, "listening") == 0)
      next = Mode::listening;
    if (strcmp(s->valuestring, "drowsy") == 0)
      next = Mode::drowsy;
    if (strcmp(s->valuestring, "thinking") == 0)
      next = Mode::thinking;
    if (strcmp(s->valuestring, "speaking") == 0)
      next = Mode::speaking;
    if (strcmp(s->valuestring, "muted") == 0)
      next = Mode::muted;
    Expression face = Expression::neutral;
    auto *e = cJSON_GetObjectItem(json, "expression");
    if (next == Mode::speaking && cJSON_IsString(e)) {
      if (strcmp(e->valuestring, "happy") == 0)
        face = Expression::happy;
      else if (strcmp(e->valuestring, "sad") == 0)
        face = Expression::sad;
      else if (strcmp(e->valuestring, "angry") == 0)
        face = Expression::angry;
      else if (strcmp(e->valuestring, "surprised") == 0)
        face = Expression::surprised;
      else if (strcmp(e->valuestring, "curious") == 0)
        face = Expression::curious;
      else if (strcmp(e->valuestring, "confused") == 0)
        face = Expression::confused;
      else if (strcmp(e->valuestring, "excited") == 0)
        face = Expression::excited;
      else if (strcmp(e->valuestring, "shy") == 0)
        face = Expression::shy;
      else if (strcmp(e->valuestring, "skeptical") == 0)
        face = Expression::skeptical;
      else if (strcmp(e->valuestring, "proud") == 0)
        face = Expression::proud;
      else if (strcmp(e->valuestring, "affectionate") == 0)
        face = Expression::affectionate;
      ESP_LOGI("face", "Speaking expression: %d", int(face));
    }
    expression = face;
    sleep_now = next == Mode::idle &&
                cJSON_IsTrue(cJSON_GetObjectItem(json, "sleep_now"));
    auto previous = mode.exchange(next);
    if (next != Mode::drowsy || previous != Mode::drowsy)
      last_activity = esp_timer_get_time();
    if (next == Mode::idle)
      reset_wake = true;
  } else if (strcmp(t->valuestring, "configure") == 0) {
    auto *codec = cJSON_GetObjectItem(json, "audio_codec");
    compressed_audio =
        cJSON_IsString(codec) && strcmp(codec->valuestring, "ima_adpcm") == 0;
    auto *batch = cJSON_GetObjectItem(json, "audio_batch_frames");
    batch_frames = cJSON_IsNumber(batch) && batch->valueint == 5 ? 5 : 1;
    auto *v = cJSON_GetObjectItem(json, "volume");
    if (cJSON_IsNumber(v))
      volume = std::clamp(v->valueint, 0, 100);
    v = cJSON_GetObjectItem(json, "prefill_ms");
    if (cJSON_IsNumber(v))
      prefill_ms = std::clamp(v->valueint, 60, batch_frames == 5 ? 1800 : 600);
    v = cJSON_GetObjectItem(json, "drowsy_seconds");
    if (cJSON_IsNumber(v))
      drowsy_seconds = std::clamp(v->valueint, 0, 3600);
    v = cJSON_GetObjectItem(json, "display_enabled");
    if (cJSON_IsBool(v))
      display_enabled = cJSON_IsTrue(v);
    v = cJSON_GetObjectItem(json, "led_enabled");
    if (cJSON_IsBool(v))
      led_enabled = cJSON_IsTrue(v);
    v = cJSON_GetObjectItem(json, "led_listening_brightness");
    if (cJSON_IsNumber(v))
      led_listening = std::clamp(v->valueint, 0, 100);
    v = cJSON_GetObjectItem(json, "led_speaking_min_brightness");
    if (cJSON_IsNumber(v))
      led_speaking_min = std::clamp(v->valueint, 0, 100);
    v = cJSON_GetObjectItem(json, "led_speaking_max_brightness");
    if (cJSON_IsNumber(v))
      led_speaking_max = std::clamp(v->valueint, 0, 100);
  } else if (strcmp(t->valuestring, "display") == 0) {
    auto *enabled = cJSON_GetObjectItem(json, "enabled");
    if (cJSON_IsBool(enabled))
      display_enabled = cJSON_IsTrue(enabled);
  } else if (strcmp(t->valuestring, "play_start") == 0) {
    auto *id = cJSON_GetObjectItem(json, "id");
    auto *bytes = cJSON_GetObjectItem(json, "bytes");
    if (!cJSON_IsString(id) || !cJSON_IsNumber(bytes) ||
        bytes->valuedouble < 0 || bytes->valuedouble > 32000 * 180)
      return;
    xQueueReset(playback);
    auto *codec = cJSON_GetObjectItem(json, "audio_codec");
    compressed_playback =
        cJSON_IsString(codec) && strcmp(codec->valuestring, "ima_adpcm") == 0;
    strncpy(play_id, id->valuestring, sizeof(play_id) - 1);
    playback_total = bytes->valueint;
    play_end = false;
    play_active = true;
    cancel_audio = false;
  } else if (strcmp(t->valuestring, "play_end") == 0) {
    play_end = true;
  } else if (strcmp(t->valuestring, "cancel") == 0) {
    cancel_audio = true;
    play_active = false;
    xQueueReset(playback);
    mouth = 0;
  }
}
static void websocket_event(void *, esp_event_base_t, int32_t event,
                            void *payload) {
  if (event == WEBSOCKET_EVENT_CONNECTED) {
    connected = true;
    hello_pending = true;
    link_status = LinkStatus::ready;
    reset_wake = true;
    ESP_LOGI("network", "Server connected");
    return;
  }
  if (event == WEBSOCKET_EVENT_DISCONNECTED ||
      event == WEBSOCKET_EVENT_CLOSED) {
    connected = false;
    link_status = network_ready() ? LinkStatus::unavailable : LinkStatus::wifi;
    mode = Mode::offline;
    cancel_audio = true;
    play_active = false;
    xQueueReset(upload);
    mouth = 0;
    return;
  }
  if (event != WEBSOCKET_EVENT_DATA)
    return;
  auto *data = (esp_websocket_event_data_t *)payload;
  static uint8_t buffer[2049];
  if (data->payload_len > 2048 || data->payload_offset + data->data_len > 2048)
    return;
  if (data->op_code != 1 && data->op_code != 2)
    return;
  memcpy(buffer + data->payload_offset, data->data_ptr, data->data_len);
  if (data->payload_offset + data->data_len < data->payload_len)
    return;
  if (data->op_code == 1) {
    buffer[data->payload_len] = 0;
    auto *j = cJSON_Parse((char *)buffer);
    if (j) {
      state_message(j);
      cJSON_Delete(j);
    }
  } else if (play_active) {
    // Decode only in the playback task so the queue stores wire-sized blocks.
    bool valid = compressed_playback && data->payload_len > 0;
    size_t offset = 0;
    int blocks = 0;
    while (valid && offset < size_t(data->payload_len)) {
      EncodedFrame frame{};
      size_t available = data->payload_len - offset;
      const auto *block = buffer + offset;
      size_t count = available >= 6 ? block[0] | (uint16_t(block[1]) << 8) : 0;
      frame.size = 5 + (count + 1) / 2;
      valid = count > 0 && count <= 320 && frame.size <= available &&
              block[4] <= 88 && ++blocks <= batch_frames;
      if (!valid)
        break;
      memcpy(frame.data, block, frame.size);
      if (xQueueSend(playback, &frame, 0) != pdTRUE) {
        valid = false;
        ESP_LOGE("audio", "Playback overflow");
        break;
      }
      offset += frame.size;
    }
    if (!valid) {
      cancel_audio = true;
      play_active = false;
      mode = Mode::error;
      ESP_LOGE("audio", "Invalid or overflowing audio batch");
    }
  }
}
static void init_audio() {
  i2s_chan_config_t rx = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  rx.dma_desc_num = 6;
  rx.dma_frame_num = 160;
  ESP_ERROR_CHECK(i2s_new_channel(&rx, nullptr, &microphone));
  i2s_std_config_t input{};
  input.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(16000);
  input.slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT,
                                                       I2S_SLOT_MODE_MONO);
  input.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;
  input.gpio_cfg.mclk = I2S_GPIO_UNUSED;
  input.gpio_cfg.bclk = GPIO_NUM_25;
  input.gpio_cfg.ws = GPIO_NUM_26;
  input.gpio_cfg.dout = I2S_GPIO_UNUSED;
  input.gpio_cfg.din = GPIO_NUM_33;
  ESP_ERROR_CHECK(i2s_channel_init_std_mode(microphone, &input));
  ESP_ERROR_CHECK(i2s_channel_enable(microphone));
  i2s_chan_config_t tx = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_1, I2S_ROLE_MASTER);
  tx.dma_desc_num = 2;
  tx.dma_frame_num = 160;
  tx.auto_clear = true;
  ESP_ERROR_CHECK(i2s_new_channel(&tx, &speaker, nullptr));
  i2s_std_config_t output{};
  output.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(16000);
  output.slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(
      I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO);
  output.gpio_cfg.mclk = I2S_GPIO_UNUSED;
  output.gpio_cfg.bclk = GPIO_NUM_27;
  output.gpio_cfg.ws = GPIO_NUM_14;
  output.gpio_cfg.dout = GPIO_NUM_32;
  output.gpio_cfg.din = I2S_GPIO_UNUSED;
  ESP_ERROR_CHECK(i2s_channel_init_std_mode(speaker, &output));
  ESP_ERROR_CHECK(i2s_channel_enable(speaker));
}
static void capture_task(void *) {
  int32_t raw[320];
  int16_t pcm[320];
  audio_codec::State encoder{};
  while (true) {
    size_t bytes = 0;
    if (i2s_channel_read(microphone, raw, sizeof(raw), &bytes, 100) != ESP_OK)
      continue;
    size_t count = bytes / 4;
    for (size_t i = 0; i < count; i++)
      pcm[i] = (int16_t)std::clamp<int32_t>(raw[i] >> 14, -32768, 32767);
    if (reset_wake.exchange(false) && wake_ready)
      wake_reset();
    auto state = mode.load();
    if ((state == Mode::idle || state == Mode::offline) && wake_ready) {
      if (wake_feed(pcm, count)) {
        wake_reset();
        last_activity = esp_timer_get_time();
        ESP_LOGI("wake", "Detected %s", wake_name());
        if (connected) {
          mode = Mode::thinking;
          wake_pending = true;
        }
      }
    } else if (conversation_capture(state) && connected && compressed_audio) {
      EncodedFrame frame{};
      frame.size = audio_codec::encode(pcm, count, frame.data, encoder);
      if (xQueueSend(upload, &frame, 0) != pdTRUE) {
        mode = Mode::error;
        capture_failed = true;
        ESP_LOGW("audio", "Microphone upload queue full");
      }
      upload_peak_ms = std::max(upload_peak_ms.load(),
                                unsigned(uxQueueMessagesWaiting(upload) * 20));
    } else {
      encoder = {};
    }
    // No inference or transmission while muted or speaking: first release is
    // half duplex.
  }
}
static void upload_task(void *) {
  EncodedFrame frame{};
  uint8_t packet[5 * 165];
  while (true) {
    if (!connected || !conversation_capture(mode.load())) {
      xQueueReset(upload);
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }
    if (xQueueReceive(upload, &frame, pdMS_TO_TICKS(50)) != pdTRUE)
      continue;
    size_t size = frame.size;
    memcpy(packet, frame.data, size);
    // At most 80 ms batching delay; TCP sees ten audio messages per second.
    for (int i = 1; i < batch_frames; ++i) {
      if (xQueueReceive(upload, &frame, pdMS_TO_TICKS(25)) != pdTRUE)
        break;
      memcpy(packet + size, frame.data, frame.size);
      size += frame.size;
    }
    if (!connected || !conversation_capture(mode.load()))
      continue;
    auto start = esp_timer_get_time();
    int sent = esp_websocket_client_send_bin(
        socket_client, reinterpret_cast<const char *>(packet), size,
        pdMS_TO_TICKS(audio_send_timeout_ms));
    unsigned elapsed = (esp_timer_get_time() - start) / 1000;
    send_max_ms = std::max(send_max_ms.load(), elapsed);
    if (sent != int(size)) {
      if (connected) {
        mode = Mode::error;
        capture_failed = true;
      }
      ESP_LOGW("audio", "Microphone transport stalled after %u ms", elapsed);
    }
  }
}
static void init_indicator() {
  ledc_timer_config_t timer{};
  timer.speed_mode = LEDC_LOW_SPEED_MODE;
  timer.duty_resolution = LEDC_TIMER_10_BIT;
  timer.timer_num = LEDC_TIMER_0;
  timer.freq_hz = 5000;
  timer.clk_cfg = LEDC_AUTO_CLK;
  ledc_channel_config_t channel{};
  channel.gpio_num = GPIO_NUM_18;
  channel.speed_mode = LEDC_LOW_SPEED_MODE;
  channel.channel = LEDC_CHANNEL_0;
  channel.timer_sel = LEDC_TIMER_0;
  channel.duty = 0;
  led_ready = ledc_timer_config(&timer) == ESP_OK &&
              ledc_channel_config(&channel) == ESP_OK;
  if (led_ready)
    ESP_LOGI("indicator", "PWM ready on GPIO18");
  else
    ESP_LOGW("indicator", "LED unavailable; voice remains enabled");
}

static void playback_task(void *) {
  Frame frame{};
  EncodedFrame encoded{};
  int16_t stereo[640];
  uint32_t consumed = 0;
  bool started = false, buffering = true;
  int64_t last_frame = 0;
  IndicatorEnvelope light;
  while (true) {
    if (cancel_audio.exchange(false)) {
      consumed = 0;
      started = false;
      buffering = true;
      mouth = 0;
      i2s_channel_disable(speaker);
      i2s_channel_enable(speaker);
    }
    if (led_ready) {
      const auto state = mode.load();
      const bool playing = play_active && started && !buffering && volume > 0;
      const int target = indicator_target(
          state, connected, portal_active, led_enabled, playing, mouth,
          led_listening, led_speaking_min, led_speaking_max);
      const int duty = light.duty(target, state == Mode::speaking && playing,
                                  led_speaking_max);
      if (duty != led_duty.load()) {
        ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, duty);
        ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
        led_duty = duty;
      }
    }
    if (!play_active) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }
    if (!started) {
      started = true;
      buffering = true;
      consumed = 0;
      last_frame = esp_timer_get_time();
    }
    if (buffering && !play_end &&
        uxQueueMessagesWaiting(playback) * 20 < unsigned(prefill_ms.load()) &&
        esp_timer_get_time() - last_frame < 8000000) {
      vTaskDelay(pdMS_TO_TICKS(5));
      continue;
    }
    buffering = false;
    if (xQueueReceive(playback, &encoded, pdMS_TO_TICKS(20)) == pdTRUE) {
      frame.size =
          2 * audio_codec::decode(encoded.data, encoded.size, frame.samples);
      double energy = 0;
      for (int i = 0; i < frame.size / 2; i++) {
        energy += double(frame.samples[i]) * frame.samples[i];
        frame.samples[i] = frame.samples[i] * volume.load() / 100;
        // Duplicate mono speech into both slots. Classic ESP32 mono 16-bit
        // mode swaps adjacent samples; stereo also supports either amp channel.
        stereo[2 * i] = stereo[2 * i + 1] = frame.samples[i];
      }
      mouth = std::clamp(
          int(std::sqrt(energy / std::max(1, int(frame.size / 2))) / 500), 0,
          11);
      size_t written = 0;
      auto result =
          i2s_channel_write(speaker, stereo, frame.size * 2, &written, 500);
      if (result != ESP_OK || written != frame.size * 2) {
        mode = Mode::error;
        cancel_audio = true;
        play_active = false;
        continue;
      }
      consumed += frame.size;
      progress("played", consumed);
      last_frame = esp_timer_get_time();
    } else {
      mouth = 0;
      if (!play_end) {
        ++underruns;
        buffering = true;
        ESP_LOGW("audio", "Playback underrun; rebuilding audio reserve");
      }
    }
    if (play_end && uxQueueMessagesWaiting(playback) == 0) {
      vTaskDelay(pdMS_TO_TICKS(35));
      mouth = 0;
      play_active = false;
      started = false;
      if (consumed == playback_total)
        progress("play_done", consumed);
      else
        mode = Mode::error;
    } else if (esp_timer_get_time() - last_frame > 8000000) {
      play_active = false;
      started = false;
      mouth = 0;
      mode = Mode::error;
    }
  }
}
extern "C" void app_main() {
  last_activity = esp_timer_get_time();
  provision_init();
  face_init();
  xTaskCreate(face_task, "face", 3072, nullptr, 2, nullptr);
  playback = xQueueCreate(audio_queue_frames, sizeof(EncodedFrame));
  upload = xQueueCreate(audio_queue_frames, sizeof(EncodedFrame));
  acknowledgements = xQueueCreate(1, sizeof(PlaybackProgress));
  if (!playback || !upload || !acknowledgements) {
    mode = Mode::error;
    return;
  }
  wake_ready = wake_init();
  if (!wake_ready)
    ESP_LOGE("wake", "Detector init failed; use panel for manual test");
  init_audio();
  init_indicator();
  xTaskCreatePinnedToCore(capture_task, "capture", 8192, nullptr, 5, nullptr,
                          1);
  xTaskCreate(playback_task, "playback", 5120, nullptr, 4, nullptr);
  xTaskCreate(progress_task, "progress", 3072, nullptr, 3, nullptr);
  xTaskCreate(upload_task, "upload", 4096, nullptr, 3, nullptr);
  gpio_set_direction(GPIO_NUM_0, GPIO_MODE_INPUT);
  gpio_set_pull_mode(GPIO_NUM_0, GPIO_PULLUP_ONLY);
  int held = 0;
  while (true) {
    if (!network_ready())
      link_status = LinkStatus::wifi;
    if (!socket_client && network_ready() && provision_pair()) {
      auto server = setting("server"), token = setting("token");
      std::string headers = "Authorization: Bearer " + token + "\r\n";
      if (!server.empty() && !token.empty()) {
        link_status = LinkStatus::server;
        esp_websocket_client_config_t cfg{};
        cfg.uri = server.c_str();
        cfg.headers = headers.c_str();
        cfg.buffer_size = 2048;
        cfg.task_stack = 5120;
        cfg.reconnect_timeout_ms = 5000;
        cfg.network_timeout_ms = 5000;
        cfg.enable_close_reconnect = true;
        cfg.crt_bundle_attach = esp_crt_bundle_attach;
        socket_client = esp_websocket_client_init(&cfg);
        esp_websocket_register_events(socket_client, WEBSOCKET_EVENT_ANY,
                                      websocket_event, nullptr);
        esp_websocket_client_start(socket_client);
      }
    }
    if (gpio_get_level(GPIO_NUM_0) == 0) {
      if (++held == 30)
        provision_open();
    } else
      held = 0;
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}
