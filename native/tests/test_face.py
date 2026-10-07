import subprocess
from pathlib import Path


def test_firmware_rest_timer_yawns_and_distinct_faces(tmp_path):
    source = tmp_path / "face_test.cpp"
    source.write_text(r"""
#include "face_art.h"
#include <cassert>
#include <cstring>
int main() {
  assert(!rest_pose(Mode::idle, 0).sleepy);
  assert(rest_pose(Mode::drowsy, 0).sleepy);
  assert(!rest_pose(Mode::drowsy, 0).yawning);
  assert(rest_pose(Mode::drowsy, 2500000).yawning);
  assert(!rest_pose(Mode::drowsy, 6000000).yawning);
  assert(rest_pose(Mode::drowsy, 27500000).yawning);
  assert(!rest_pose(Mode::listening, 2500000).sleepy);
  assert(conversation_capture(Mode::listening));
  assert(conversation_capture(Mode::drowsy));
  assert(!conversation_capture(Mode::idle));
  assert(!conversation_capture(Mode::speaking));
  assert(!conversation_capture(Mode::muted));
  uint8_t sleep[1024]{}, blink[1024]{}, bored[1024]{}, yawn[1024]{};
  FaceArt{sleep}.draw(Mode::idle, Expression::neutral, false, false, false, 0);
  FaceArt{blink}.draw(Mode::idle, Expression::neutral, false, true, false, 0);
  FaceArt{bored}.draw(Mode::drowsy, Expression::neutral, true, false, false, 0);
  FaceArt{yawn}.draw(Mode::drowsy, Expression::neutral, true, false, true, 0);
  assert(!std::memcmp(sleep, blink, 1024));
  assert(std::memcmp(sleep, bored, 1024));
  assert(std::memcmp(yawn, bored, 1024));
  // Bored eyelids are not the closed sleeping lines.
  assert(std::memcmp(sleep + 3*128, bored + 3*128, 128));
  uint8_t thought[1024]{}, curious[1024]{};
  FaceArt{thought}.draw(Mode::thinking, Expression::neutral, false, false, false, 0);
  FaceArt{curious}.draw(Mode::speaking, Expression::curious, false, false, false, 0);
  assert(std::memcmp(thought, curious, 1024));
  assert(thinking_shift(0) == 0);
  assert(thinking_shift(800000) == 4);
  assert(thinking_shift(2400000) == -4);
  uint8_t left[1024]{}, right[1024]{}, mouth[1024]{};
  FaceArt{left}.draw(Mode::thinking, Expression::neutral, false, false, false, 0, false, -4);
  FaceArt{right}.draw(Mode::thinking, Expression::neutral, false, false, false, 0, false, 4);
  for (int page = 0; page < 8; page++)
    for (int x = 0; x < 120; x++)
      assert(left[page*128+x] == right[page*128+x+8]);
  // The bubble region is empty throughout the movement.
  for (int page = 0; page < 5; page++)
    for (int x = 100; x < 128; x++)
      assert(!left[page*128+x] && !right[page*128+x]);
  FaceArt{mouth}.draw(Mode::speaking, Expression::happy, false, false, false, 6);
  assert(mouth[62 + (50/8)*128] & (1 << (50%8)));
  assert(yawn[62 + (50/8)*128] & (1 << (50%8)));
  // Every expression remains distinguishable while sharing the same speaking mouth.
  Expression feelings[] = {Expression::neutral, Expression::happy, Expression::sad,
    Expression::angry, Expression::surprised, Expression::curious,
    Expression::confused, Expression::excited, Expression::shy,
    Expression::skeptical, Expression::proud, Expression::affectionate};
  uint8_t faces[12][1024]{};
  for (int i = 0; i < 12; ++i) {
    FaceArt{faces[i]}.draw(Mode::speaking, feelings[i], false, false, false, 6);
    for (int j = 0; j < i; ++j)
      assert(std::memcmp(faces[i], faces[j], 5*128));
  }
  // Curiosity keeps equal-height attentive eyes; confusion keeps the uneven lids.
  auto lit = [](const uint8_t *s, int x, int y) { return bool(s[x+(y/8)*128] & (1 << (y%8))); };
  for (int y = 10; y < 39; ++y)
    for (int dx = -12; dx <= 12; ++dx)
      assert(lit(faces[5], 38+dx, y) == lit(faces[5], 86+dx, y));
}
""")
    binary = tmp_path / "face_test"
    headers = Path(__file__).resolve().parents[1] / "firmware/main"
    subprocess.run(
        [
            "g++",
            "-std=c++17",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-I",
            str(headers),
            str(source),
            "-o",
            str(binary),
        ],
        check=True,
    )
    subprocess.run([str(binary)], check=True)
