// Export the actual firmware renderer as PBM images for visual review.
#include "face_art.h"
#include <cstdio>
#include <filesystem>
#include <string>

static void render(const std::string &directory, const char *name, Mode state,
                   Expression feeling = Expression::neutral,
                   bool sleepy = false, bool yawn = false, int mouth = 6,
                   int shift = 0) {
  uint8_t screen[1024]{};
  FaceArt{screen}.draw(state, feeling, sleepy, false, yawn, mouth, false,
                       shift);
  auto path = directory + "/" + name + ".pbm";
  auto *file = std::fopen(path.c_str(), "w");
  if (!file)
    std::exit(1);
  std::fprintf(file, "P1\n128 64\n");
  for (int y = 0; y < 64; y++) {
    for (int x = 0; x < 128; x++)
      std::fprintf(file, "%d ", !(screen[x + (y / 8) * 128] & (1 << (y % 8))));
    std::fprintf(file, "\n");
  }
  std::fclose(file);
}
int main(int argc, char **argv) {
  if (argc != 2)
    return 1;
  std::filesystem::create_directories(argv[1]);
  render(argv[1], "sleep", Mode::idle);
  render(argv[1], "listening", Mode::listening);
  render(argv[1], "drowsy", Mode::drowsy, Expression::neutral, true);
  render(argv[1], "yawn", Mode::drowsy, Expression::neutral, true, true);
  render(argv[1], "thinking", Mode::thinking);
  render(argv[1], "thinking_left", Mode::thinking, Expression::neutral, false,
         false, 0, -4);
  render(argv[1], "thinking_right", Mode::thinking, Expression::neutral, false,
         false, 0, 4);
  render(argv[1], "neutral", Mode::speaking);
  render(argv[1], "happy", Mode::speaking, Expression::happy);
  render(argv[1], "sad", Mode::speaking, Expression::sad);
  render(argv[1], "angry", Mode::speaking, Expression::angry);
  render(argv[1], "surprised", Mode::speaking, Expression::surprised);
  render(argv[1], "curious", Mode::speaking, Expression::curious);
  render(argv[1], "confused", Mode::speaking, Expression::confused);
  render(argv[1], "excited", Mode::speaking, Expression::excited);
  render(argv[1], "shy", Mode::speaking, Expression::shy);
  render(argv[1], "skeptical", Mode::speaking, Expression::skeptical);
  render(argv[1], "proud", Mode::speaking, Expression::proud);
  render(argv[1], "affectionate", Mode::speaking, Expression::affectionate);
}
