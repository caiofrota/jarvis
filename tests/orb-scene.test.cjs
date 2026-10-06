const { test } = require('node:test');
const assert = require('node:assert/strict');
const { drawOrb, orbSpeed } = require('../dist/features/voice/orb/scene.js');

function render(phase, level = 0, simple = false) {
  const colors = [],
    strokes = [],
    points = [],
    flares = [];
  const ctx = {
    clearRect() {},
    save() {},
    translate() {},
    fillRect() {},
    beginPath() {},
    closePath() {},
    restore() {},
    createRadialGradient(...args) {
      flares.push(args);
      return { addColorStop: (at, color) => colors.push({ at, color }) };
    },
    moveTo(x, y) {
      points.push([x, y]);
    },
    lineTo(x, y) {
      points.push([x, y]);
    },
    stroke() {
      strokes.push({ width: this.lineWidth, glow: this.shadowBlur });
    },
  };
  drawOrb(ctx, 420, 420, { time: 2, phase, frame: { level, bass: 0.4, mid: 0.4, high: 0.4 }, simple });
  return { colors, strokes, points, flares };
}

test('speaking increases glow, filament width and energy even for system voices', () => {
  const idle = render('idle'),
    speaking = render('speaking'),
    loud = render('speaking', 0.8);
  assert.ok(speaking.strokes[0].glow > idle.strokes[0].glow);
  assert.ok(speaking.strokes[0].width > idle.strokes[0].width);
  assert.ok(loud.strokes[0].glow > speaking.strokes[0].glow);
  assert.notDeepEqual(loud.points, speaking.points);
  assert.equal(loud.strokes.length, idle.strokes.length, 'same rendering budget');
  assert.equal(loud.flares.length, idle.flares.length);
  assert.ok(loud.points.every((point) => point.every(Number.isFinite)));
});

test('speaking runs faster while reduced motion stays stopped and economical rendering stays bounded', () => {
  assert.ok(orbSpeed('speaking', true) > orbSpeed('thinking', true));
  assert.ok(orbSpeed('speaking', true) > orbSpeed('idle', true));
  assert.equal(orbSpeed('speaking', false), 0);
  const economy = render('speaking', 1, true);
  assert.equal(economy.strokes.length, 7);
  assert.ok(economy.strokes.every((stroke) => stroke.glow === 0));
});
