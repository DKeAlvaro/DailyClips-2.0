// Feedback you can feel: tiny synthesised sounds (nothing to download) and vibration.
// Every sound the interface makes plays through <audio> elements, the same path as the YouTube
// player. Web Audio is kept for the microphone only: on phones it can stay silent while the video
// is heard (iOS mutes it with the silent switch, some Androids never open its output).
import { S } from './store.js';
import { isIOS } from './ctx.js';

let ac = null;
function ctx() {
  if (!ac) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ac = new C();
  }
  if (ac.state !== 'running') ac.resume().catch(() => {});
  return ac;
}

/** The shared AudioContext, for capture. Call it from inside a tap: iOS only lets audio start there. */
export const audioContext = () => ctx();

const RATE = 22050;

/** 16-bit mono WAV of the samples (-1..1), as a blob URL. */
function wavUrl(x) {
  const n = x.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

const lanes = {}; // name -> the <audio> element that plays that kind of sound
const lane = (name) => (lanes[name] ||= Object.assign(new Audio(), { preload: 'auto' }));

/**
 * Plays a URL on a lane (a new sound on the same lane replaces the old one). Returns { stop };
 * onStart fires when the sound is really playing, onEnd(true) when it played to the end and
 * onEnd(false) when it was stopped, replaced or refused by the browser.
 */
export function playUrl(name, url, { volume = 1, onStart, onEnd } = {}) {
  const e = lane(name);
  let over = false;
  const me = {
    stop() {
      if (over) return;
      try { e.pause(); } catch { /* nothing playing */ }
      done(false);
    },
  };
  const done = (ok) => {
    if (over) return;
    over = true;
    if (e.cur === me) e.onended = e.onerror = e.cur = null;
    onEnd?.(ok);
  };
  e.cur?.stop();
  e.cur = me;
  e.onended = () => done(true);
  e.onerror = () => done(false);
  e.src = url;
  e.volume = volume;
  e.play().then(() => { if (!over) onStart?.(); }, () => done(false));
  return me;
}

// iOS lets an <audio> element start from code only after it was started once inside a tap, and
// then for any later source: play a silent clip on every lane at the first taps of the page.
// Elsewhere the first tap on the page is enough already.
let unlocked = !isIOS();
export function unlockSound() {
  if (unlocked) return;
  const clip = wavUrl(new Float32Array(RATE / 20));
  Promise.all(['sfx', 'voice'].map((n) => {
    const e = lane(n);
    if (e.cur) return true; // busy with a real sound: it was started inside a tap already
    e.src = clip;
    e.volume = 0;
    return e.play().then(() => { if (!e.cur) e.pause(); return true; }, () => false);
  })).then((r) => { if (r.every(Boolean)) unlocked = true; });
}
if (!unlocked) for (const ev of ['pointerup', 'touchend', 'click']) document.addEventListener(ev, unlockSound, { capture: true, passive: true });

const tones = {}; // key -> blob URL

/** notes: [frequency Hz, start s, duration s, gain]. Same envelope as an oscillator ramped up and down. */
function play(key, notes, type = 'sine') {
  if (!S.sound) return;
  if (!tones[key]) {
    const x = new Float32Array(Math.ceil(RATE * (Math.max(...notes.map((n) => n[1] + n[2])) + 0.05)));
    for (const [f, at, d, g = 0.16] of notes) {
      const i0 = Math.floor(at * RATE), n = Math.floor(d * RATE);
      for (let i = 0; i < n && i0 + i < x.length; i++) {
        const t = i / RATE;
        const env = t < 0.015 ? 0.0001 * (g / 0.0001) ** (t / 0.015) : g * (0.0001 / g) ** ((t - 0.015) / (d - 0.015));
        const ph = 2 * Math.PI * f * t;
        x[i0 + i] += (type === 'triangle' ? (2 / Math.PI) * Math.asin(Math.sin(ph)) : Math.sin(ph)) * env * 2;
      }
    }
    tones[key] = wavUrl(x);
  }
  playUrl('sfx', tones[key]);
}

export const sfx = {
  unlock: unlockSound,
  good: () => play('good', [[659, 0, 0.14], [988, 0.09, 0.26]]),
  mid: () => play('mid', [[523, 0, 0.14], [587, 0.1, 0.2]]),
  low: () => play('low', [[330, 0, 0.2, 0.12], [294, 0.12, 0.26, 0.1]], 'triangle'),
  start: () => play('start', [[880, 0, 0.09, 0.08]]),
  done: () => play('done', [[523, 0, 0.16], [659, 0.12, 0.16], [784, 0.24, 0.16], [1047, 0.36, 0.42]]),
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
