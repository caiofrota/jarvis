import { useEffect, useRef } from 'react';
import type { Profile } from '../../../shared/types';
import type { VoiceFrame } from '../audio-meter';
import { drawOrb, orbSpeed, type OrbPhase } from './scene';

interface Props {
  phase: OrbPhase;
  profile: Profile;
  motion: boolean;
  sample(): VoiceFrame;
}
export default function EnergyRing(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0,
      previous = 0,
      clock = 0,
      visible = true;
    let width = 0,
      height = 0;
    const smooth: VoiceFrame = { level: 0, bass: 0, mid: 0, high: 0 };
    const render = (now: number) => {
      raf = 0;
      if (document.hidden || !visible) return;
      const current = latest.current;
      const simple = current.profile === 'eco';
      const animate = current.motion && !reduced.matches;
      const interval = !animate
        ? 200
        : simple
          ? 1000 / 20
          : current.profile === 'full'
            ? 1000 / 45
            : 1000 / 30;
      if (now - previous >= interval) {
        const delta = Math.min(0.1, (now - previous) / 1000);
        previous = now;
        const bounds = element.getBoundingClientRect();
        const ratio = Math.min(devicePixelRatio || 1, simple ? 1 : 1.5);
        if (
          bounds.width !== width ||
          bounds.height !== height ||
          element.width !== Math.round(bounds.width * ratio)
        ) {
          width = bounds.width;
          height = bounds.height;
          element.width = Math.round(width * ratio);
          element.height = Math.round(height * ratio);
          context.setTransform(ratio, 0, 0, ratio, 0, 0);
        }
        clock += delta * orbSpeed(current.phase, animate);
        const sample = animate ? current.sample() : { level: 0, bass: 0, mid: 0, high: 0 };
        const mix = 1 - Math.exp(-delta * 16);
        for (const key of ['level', 'bass', 'mid', 'high'] as const)
          smooth[key] = animate ? smooth[key] + (sample[key] - smooth[key]) * mix : 0;
        drawOrb(context, width, height, { time: clock, phase: current.phase, frame: smooth, simple });
      }
      raf = requestAnimationFrame(render);
    };
    const restart = () => {
      if (!document.hidden && visible && !raf) {
        previous = 0;
        raf = requestAnimationFrame(render);
      }
      if (document.hidden || !visible) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      restart();
    });
    observer.observe(element);
    document.addEventListener('visibilitychange', restart);
    restart();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener('visibilitychange', restart);
    };
  }, []);
  return <canvas ref={canvas} className="energy-canvas" aria-hidden="true" />;
}
