#include "appearance.h"
#include "driver/i2c.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "face_art.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "robot.h"
#include <algorithm>
#include <cmath>
#include <cstring>
static uint8_t screen[1024];
static bool display_ok = false;
static void command(uint8_t x) {
  uint8_t b[] = {0, x};
  i2c_master_write_to_device(I2C_NUM_0, 0x3c, b, 2, pdMS_TO_TICKS(20));
}
static void pixel(int x, int y) {
  if (x >= 0 && x < 128 && y >= 0 && y < 64)
    screen[x + (y / 8) * 128] |= 1 << (y % 8);
}
static void rectangle(int x, int y, int w, int h) {
  for (int j = y; j < y + h; j++)
    for (int i = x; i < x + w; i++)
      pixel(i, j);
}
static void label(const char *text) {
  static const uint8_t letters[26][5] = {{0x7e, 0x11, 0x11, 0x11, 0x7e},
                                         {0x7f, 0x49, 0x49, 0x49, 0x36},
                                         {0x3e, 0x41, 0x41, 0x41, 0x22},
                                         {0x7f, 0x41, 0x41, 0x22, 0x1c},
                                         {0x7f, 0x49, 0x49, 0x49, 0x41},
                                         {0x7f, 0x09, 0x09, 0x09, 0x01},
                                         {0x3e, 0x41, 0x49, 0x49, 0x7a},
                                         {0x7f, 8, 8, 8, 0x7f},
                                         {0, 0x41, 0x7f, 0x41, 0},
                                         {0x20, 0x40, 0x41, 0x3f, 1},
                                         {0x7f, 8, 0x14, 0x22, 0x41},
                                         {0x7f, 0x40, 0x40, 0x40, 0x40},
                                         {0x7f, 2, 0x0c, 2, 0x7f},
                                         {0x7f, 4, 8, 0x10, 0x7f},
                                         {0x3e, 0x41, 0x41, 0x41, 0x3e},
                                         {0x7f, 9, 9, 9, 6},
                                         {0x3e, 0x41, 0x51, 0x21, 0x5e},
                                         {0x7f, 9, 0x19, 0x29, 0x46},
                                         {0x46, 0x49, 0x49, 0x49, 0x31},
                                         {1, 1, 0x7f, 1, 1},
                                         {0x3f, 0x40, 0x40, 0x40, 0x3f},
                                         {0x1f, 0x20, 0x40, 0x20, 0x1f},
                                         {0x3f, 0x40, 0x38, 0x40, 0x3f},
                                         {0x63, 0x14, 8, 0x14, 0x63},
                                         {7, 8, 0x70, 8, 7},
                                         {0x61, 0x51, 0x49, 0x45, 0x43}};
  int x = std::max(0, (128 - int(strlen(text)) * 6) / 2);
  for (const char *c = text; *c; c++, x += 6)
    if (*c >= 'A' && *c <= 'Z')
      for (int col = 0; col < 5; col++)
        for (int row = 0; row < 7; row++)
          if (letters[*c - 'A'][col] & (1 << row))
            pixel(x + col, row);
}
static void number(int digit, int x, int y) {
  static const uint8_t masks[] = {0x3f, 6,    0x5b, 0x4f, 0x66,
                                  0x6d, 0x7d, 7,    0x7f, 0x6f};
  uint8_t m = masks[digit];
  if (m & 1)
    rectangle(x + 1, y, 5, 1);
  if (m & 2)
    rectangle(x + 6, y + 1, 1, 5);
  if (m & 4)
    rectangle(x + 6, y + 7, 1, 5);
  if (m & 8)
    rectangle(x + 1, y + 12, 5, 1);
  if (m & 16)
    rectangle(x, y + 7, 1, 5);
  if (m & 32)
    rectangle(x, y + 1, 1, 5);
  if (m & 64)
    rectangle(x + 1, y + 6, 5, 1);
}
void face_init() {
  i2c_config_t cfg{};
  cfg.mode = I2C_MODE_MASTER;
  cfg.sda_io_num = GPIO_NUM_21;
  cfg.scl_io_num = GPIO_NUM_22;
  cfg.sda_pullup_en = GPIO_PULLUP_ENABLE;
  cfg.scl_pullup_en = GPIO_PULLUP_ENABLE;
  cfg.master.clk_speed = 400000;
  if (i2c_param_config(I2C_NUM_0, &cfg) != ESP_OK ||
      i2c_driver_install(I2C_NUM_0, cfg.mode, 0, 0, 0) != ESP_OK)
    return;
  const uint8_t init[] = {0xae, 0xd5, 0x80, 0xa8, 0x3f, 0xd3, 0,    0x40, 0x8d,
                          0x14, 0x20, 0,    0xa1, 0xc8, 0xda, 0x12, 0x81, 0x8f,
                          0xd9, 0xf1, 0xdb, 0x40, 0xa4, 0xa6, 0xaf};
  for (auto x : init)
    command(x);
  display_ok = true;
}
void face_task(void *) {
  int64_t blink_at = esp_timer_get_time() + 3000000, blink_end = 0;
  bool panel_on = true;
  while (true) {
    if (!display_ok) {
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }
    const bool visible = display_visible(display_enabled, portal_active);
    if (visible != panel_on) {
      command(visible ? 0xaf : 0xae);
      panel_on = visible;
    }
    if (!visible) {
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }
    auto now = esp_timer_get_time();
    auto state = mode.load();
    std::memset(screen, 0, sizeof(screen));
    if (now >= blink_at) {
      blink_end = now + 150000;
      blink_at = now + 2500000 + esp_random() % 3500000;
    }
    auto rest = rest_pose(state, now - last_activity.load());
    FaceArt{screen}.draw(state, expression.load(), rest.sleepy, now < blink_end,
                         rest.yawning, mouth.load(), portal_active,
                         thinking_shift(now - last_activity.load()));
    if (portal_active && !portal_pin.empty())
      for (int i = 0; i < 8; i++)
        number(portal_pin[i] - '0', 24 + i * 10, 50);
    const char *caption = "";
    if (portal_active)
      caption = "SENHA WIFI ROSIE";
    else if (!connected) {
      switch (link_status.load()) {
      case LinkStatus::wifi:
        caption = "CONECTANDO WIFI";
        break;
      case LinkStatus::server:
        caption = "CONECTANDO SERVIDOR";
        break;
      case LinkStatus::pairing:
        caption = "VINCULANDO";
        break;
      case LinkStatus::bad_pin:
        caption = "PIN INVALIDO";
        break;
      default:
        caption = "SEM SERVIDOR";
        break;
      }
    } else if (state == Mode::error)
      caption = "ERRO NO AUDIO";
    label(caption);
    command(0x21);
    command(0);
    command(127);
    command(0x22);
    command(0);
    command(7);
    uint8_t buffer[129];
    buffer[0] = 0x40;
    for (int i = 0; i < 8; i++) {
      std::memcpy(buffer + 1, screen + 128 * i, 128);
      i2c_master_write_to_device(I2C_NUM_0, 0x3c, buffer, 129,
                                 pdMS_TO_TICKS(15));
    }
    vTaskDelay(pdMS_TO_TICKS(66));
  }
}
