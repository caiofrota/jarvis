// Streaming frontend/quantization convention follows microWakeWord (Kevin
// Ahrendt) and 0xD34D/micro_wake_word_standalone. See THIRD_PARTY.md and
// GPL-3.0 license.
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "robot.h"
#include "wake_model.h"
#include <algorithm>
#include <cstring>
#include <frontend.h>
#include <frontend_util.h>
#include <tensorflow/lite/micro/micro_interpreter.h>
#include <tensorflow/lite/micro/micro_mutable_op_resolver.h>
#include <tensorflow/lite/micro/micro_resource_variable.h>

static FrontendState frontend{};
static tflite::MicroMutableOpResolver<20> ops;
static tflite::MicroInterpreter *interpreter;
static int stride_index = 0, probability_index = 0, warmup = 0;
static uint8_t probabilities[WAKE_WINDOW]{};
static float elapsed_ms = 0;

bool wake_init() {
  ops.AddCallOnce();
  ops.AddVarHandle();
  ops.AddReshape();
  ops.AddReadVariable();
  ops.AddStridedSlice();
  ops.AddConcatenation();
  ops.AddAssignVariable();
  ops.AddConv2D();
  ops.AddMul();
  ops.AddAdd();
  ops.AddMean();
  ops.AddFullyConnected();
  ops.AddLogistic();
  ops.AddQuantize();
  ops.AddDepthwiseConv2D();
  ops.AddAveragePool2D();
  ops.AddMaxPool2D();
  ops.AddPad();
  ops.AddPack();
  ops.AddSplitV();
  FrontendConfig cfg{};
  FrontendFillConfigWithDefaults(&cfg);
  cfg.window.size_ms = 30;
  cfg.window.step_size_ms = WAKE_STEP_MS;
  cfg.filterbank.num_channels = 40;
  cfg.filterbank.lower_band_limit = 125;
  cfg.filterbank.upper_band_limit = 7500;
  cfg.noise_reduction.smoothing_bits = 10;
  cfg.noise_reduction.even_smoothing = .025;
  cfg.noise_reduction.odd_smoothing = .06;
  cfg.noise_reduction.min_signal_remaining = .05;
  cfg.pcan_gain_control.enable_pcan = 1;
  cfg.pcan_gain_control.strength = .95;
  cfg.pcan_gain_control.offset = 80;
  cfg.pcan_gain_control.gain_bits = 21;
  cfg.log_scale.enable_log = 1;
  cfg.log_scale.scale_shift = 6;
  if (!FrontendPopulateState(&cfg, &frontend, 16000))
    return false;
  auto *arena =
      (uint8_t *)heap_caps_aligned_alloc(16, WAKE_ARENA, MALLOC_CAP_8BIT);
  auto *variables =
      (uint8_t *)heap_caps_aligned_alloc(16, 2048, MALLOC_CAP_8BIT);
  if (!arena || !variables)
    return false;
  auto *allocator = tflite::MicroAllocator::Create(variables, 2048);
  auto *resources = tflite::MicroResourceVariables::Create(allocator, 20);
  const auto *model = tflite::GetModel(wake_model);
  if (model->version() != TFLITE_SCHEMA_VERSION)
    return false;
  interpreter =
      new tflite::MicroInterpreter(model, ops, arena, WAKE_ARENA, resources);
  if (interpreter->AllocateTensors() != kTfLiteOk)
    return false;
  const auto *in = interpreter->input(0);
  const auto *out = interpreter->output(0);
  if (in->type != kTfLiteInt8 || in->dims->size != 3 ||
      in->dims->data[2] != 40 || out->type != kTfLiteUInt8 || out->bytes != 1)
    return false;
  ESP_LOGI("wake", "Loaded %s, arena=%u, free heap=%lu", WAKE_NAME,
           (unsigned)interpreter->arena_used_bytes(),
           (unsigned long)esp_get_free_heap_size());
  return true;
}
void wake_reset() {
  std::memset(probabilities, 0, sizeof(probabilities));
  stride_index = 0;
  warmup = 0;
  FrontendReset(&frontend);
  if (interpreter)
    interpreter->Reset();
}
bool wake_feed(const int16_t *data, size_t count) {
  if (!interpreter)
    return false;
  auto start = esp_timer_get_time();
  bool detected = false;
  while (count) {
    size_t used = 0;
    auto result = FrontendProcessSamples(&frontend, data, count, &used);
    if (!used)
      break;
    data += used;
    count -= used;
    if (result.size != 40)
      continue;
    auto *input = interpreter->input(0);
    for (int i = 0; i < 40; i++) {
      int value = ((result.values[i] * 256 + 333) / 666) - 128;
      input->data.int8[40 * stride_index + i] =
          (int8_t)std::clamp(value, -128, 127);
    }
    if (++stride_index < input->dims->data[1])
      continue;
    stride_index = 0;
    if (interpreter->Invoke() != kTfLiteOk)
      continue;
    probabilities[probability_index++ % WAKE_WINDOW] =
        interpreter->output(0)->data.uint8[0];
    int sum = 0;
    for (auto value : probabilities)
      sum += value;
    if (++warmup > 30 && sum / (255.0f * WAKE_WINDOW) >= WAKE_CUTOFF)
      detected = true;
  }
  elapsed_ms = (esp_timer_get_time() - start) / 1000.0f;
  return detected;
}
const char *wake_name() { return WAKE_NAME; }
float wake_elapsed_ms() { return elapsed_ms; }
