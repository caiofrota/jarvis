import subprocess
from pathlib import Path


def test_indicator_follows_capture_and_playback_without_lighting_sleep(tmp_path):
    source = tmp_path / "appearance.cpp"
    source.write_text(r"""
#include "appearance.h"
#include <cassert>
int main() {
  auto target = [](Mode state, bool online=true, bool portal=false, bool enabled=true,
                   bool playing=true, int level=11) {
    return indicator_target(state, online, portal, enabled, playing, level, 25, 10, 80);
  };
  assert(target(Mode::listening) == 25);
  assert(target(Mode::drowsy) == 25);
  assert(target(Mode::speaking) == 80);
  assert(target(Mode::speaking, true, false, true, true, 0) == 10);
  assert(target(Mode::speaking, true, false, true, false) == 0);
  for (auto state : {Mode::idle, Mode::thinking, Mode::error, Mode::muted, Mode::offline})
    assert(target(state) == 0);
  for (auto state : {Mode::listening, Mode::speaking}) {
    assert(target(state, false) == 0);
    assert(target(state, true, true) == 0);
    assert(target(state, true, false, false) == 0);
  }
  assert(indicator_target(Mode::speaking,true,false,true,true,999,999,999,999) == 100);
  assert(indicator_target(Mode::speaking,true,false,true,true,0,25,80,20) == 20);
  IndicatorEnvelope light;
  const int quiet = light.duty(10, true, 80);
  const int louder = light.duty(80, true, 80);
  assert(louder > quiet && louder < 819);
  const int fading = light.duty(10, true, 80);
  assert(fading > quiet && fading < louder);
  assert(light.duty(20, true, 20) <= 205);
  assert(light.duty(0, true, 80) == 0);
  assert(light.duty(25, false, 80) == 256);
  assert(light.duty(100, false, 100) == 1023);
  assert(display_visible(true, false));
  assert(!display_visible(false, false));
  assert(display_visible(false, true));
}
""")
    binary = tmp_path / "appearance"
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
