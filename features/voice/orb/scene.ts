import type { VoiceFrame } from '../audio-meter';
export type OrbPhase = 'idle' | 'preparing' | 'listening' | 'thinking' | 'speaking' | 'settling';
export interface OrbScene {
  time: number;
  phase: OrbPhase;
  frame: VoiceFrame;
  simple: boolean;
}
const TAU = Math.PI * 2;

/** Flowing filaments around an empty center. No intersecting atomic orbits. */
function radiusAt(angle: number, layer: number, time: number, energy: number, detail: number) {
  return (
    1 +
    Math.sin(angle * 3 + layer * 0.73 - time * 0.48) * (0.055 + energy * 0.025) +
    Math.cos(angle * 5 - layer * 0.52 + time * 0.37) * (0.028 + detail * energy * 0.028) +
    Math.sin(angle * 2 + layer * 1.31 + time * 0.24) * 0.045
  );
}

export function drawOrb(ctx: CanvasRenderingContext2D, width: number, height: number, scene: OrbScene) {
  const { time: t, phase, frame: f, simple } = scene;
  const r = Math.min(width * 0.385, height * 0.39);
  const energy = phase === 'speaking' ? f.level : 0;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  const glow = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.48);
  glow.addColorStop(0, 'rgba(0,58,203,0)');
  glow.addColorStop(0.55, 'rgba(0,92,255,0.12)');
  glow.addColorStop(0.72, 'rgba(0,150,255,0.18)');
  glow.addColorStop(1, 'rgba(0,70,244,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.globalCompositeOperation = 'screen';

  // Slow, deterministic dust: bounded count, no allocations or random flicker.
  const particles = simple ? 12 : 32;
  for (let i = 0; i < particles; i++) {
    const angle = i * 2.399 + t * (i % 2 ? 0.013 : -0.018);
    const distance = r * (0.4 + (((i * 37) % 97) / 97) * 1.12);
    const x = Math.cos(angle) * distance,
      y = Math.sin(angle) * distance;
    ctx.fillStyle = 'rgba(67,183,255,' + (0.12 + (i % 5) * 0.045) + ')';
    ctx.fillRect(x, y, i % 6 === 0 ? 1.5 : 0.7, i % 6 === 0 ? 1.5 : 0.7);
  }

  const layers = simple ? 7 : 14;
  const steps = simple ? 100 : 180;
  for (let layer = 0; layer < layers; layer++) {
    const spread = (layer / (layers - 1) - 0.5) * 0.15;
    const rotation = t * (layer % 2 ? 0.045 : -0.065) + layer * 0.31;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * TAU;
      const radius = r * (radiusAt(angle, layer, t, energy, f.mid) + spread + energy * 0.035);
      const x = Math.cos(angle + rotation) * radius;
      const y = Math.sin(angle + rotation) * radius * (0.98 + Math.sin(t * 0.2 + layer) * 0.015);
      if (!i) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const bright = layer % 4 === 0;
    ctx.strokeStyle = bright ? 'rgba(25,208,255,' + (0.52 + energy * 0.3) + ')' : 'rgba(14,133,255,0.35)';
    ctx.lineWidth = bright ? 1.05 + energy * 0.5 : 0.65;
    ctx.shadowColor = '#008cff';
    ctx.shadowBlur = !simple && bright ? 7 : 0;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  // Moving highlights follow the filaments, creating continuous rotation.
  const nodes = simple ? 3 : 6;
  for (let i = 0; i < nodes; i++) {
    const layer = i * 2;
    const angle = t * (i % 2 ? -0.3 : 0.24) + i * 1.73;
    const rotation = t * (layer % 2 ? 0.045 : -0.065) + layer * 0.31;
    const spread = (layer / (layers - 1) - 0.5) * 0.15;
    const radius = r * (radiusAt(angle, layer, t, energy, f.mid) + spread + energy * 0.035);
    const x = Math.cos(angle + rotation) * radius,
      y = Math.sin(angle + rotation) * radius;
    const size = 7 + energy * (7 + f.high * 4);
    const flare = ctx.createRadialGradient(x, y, 0, x, y, size);
    flare.addColorStop(0, 'rgba(149,247,255,0.85)');
    flare.addColorStop(0.18, 'rgba(0,199,255,0.6)');
    flare.addColorStop(1, 'rgba(0,122,255,0)');
    ctx.fillStyle = flare;
    ctx.fillRect(x - size, y - size, size * 2, size * 2);
  }
  ctx.restore();
}
