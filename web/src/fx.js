// Feedback you can feel: tiny synthesised sounds (nothing to download) and vibration.
import { S } from './store.js';

let ac = null;
function ctx() {
  if (!ac) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ac = new C();
  }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}

/** notes: [frequency Hz, start s, duration s, gain] */
function play(notes, type = 'sine') {
  if (!S.sound) return;
  const a = ctx();
  if (!a) return;
  const t0 = a.currentTime + 0.01;
  for (const [f, at, d, g = 0.16] of notes) {
    const o = a.createOscillator(), v = a.createGain();
    o.type = type;
    o.frequency.value = f;
    v.gain.setValueAtTime(0.0001, t0 + at);
    v.gain.exponentialRampToValueAtTime(g, t0 + at + 0.015);
    v.gain.exponentialRampToValueAtTime(0.0001, t0 + at + d);
    o.connect(v).connect(a.destination);
    o.start(t0 + at);
    o.stop(t0 + at + d + 0.03);
  }
}

export const sfx = {
  unlock: () => ctx(),
  good: () => play([[659, 0, 0.14], [988, 0.09, 0.26]]),
  mid: () => play([[523, 0, 0.14], [587, 0.1, 0.2]]),
  low: () => play([[330, 0, 0.2, 0.12], [294, 0.12, 0.26, 0.1]], 'triangle'),
  start: () => play([[880, 0, 0.09, 0.08]]),
  done: () => play([[523, 0, 0.16], [659, 0.12, 0.16], [784, 0.24, 0.16], [1047, 0.36, 0.42]]),
};

export function buzz(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch { /* not allowed */ }
}

export function scoreFx(score) {
  if (score >= 80) {
    sfx.good();
    buzz([12, 40, 18]);
  } else if (score >= 50) {
    sfx.mid();
    buzz(14);
  } else {
    sfx.low();
    buzz(30);
  }
}
