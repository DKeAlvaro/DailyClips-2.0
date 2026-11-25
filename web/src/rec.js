// Microphone capture for the phoneme levels: raw PCM, trimmed to the speech and resampled to 16 kHz.
import { audioContext } from './fx.js';

const RATE = 16000;

/** Windowed-sinc resampler (16 zero crossings), good enough to keep a phoneme model happy. */
export function resample(x, from, to = RATE) {
  if (from === to) return x;
  const ratio = from / to, n = Math.floor(x.length / ratio), out = new Float32Array(n);
  const scale = Math.max(1, ratio), half = 8 * scale;
  for (let i = 0; i < n; i++) {
    const c = i * ratio;
    const a = Math.max(0, Math.ceil(c - half)), b = Math.min(x.length - 1, Math.floor(c + half));
    let sum = 0, w = 0;
    for (let j = a; j <= b; j++) {
      const d = (j - c) / scale;
      const sinc = d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d);
      const win = 0.5 + 0.5 * Math.cos((Math.PI * (j - c)) / half);
      sum += x[j] * sinc * win;
      w += sinc * win;
    }
    out[i] = w ? sum / w : 0;
  }
  return out;
}

/**
 * Records one take. Returns { promise, stop }.
 * promise -> { ok: true, pcm: Float32Array (16 kHz mono), seconds } | { ok: false, why }
 * Stops by itself about a second after the speaker goes quiet, at maxMs, or when stop() is called.
 */
export function record({ maxMs = 12000, onLevel, onStart } = {}) {
  let stopNow = () => {};
  const ac = audioContext(); // created inside the tap that started this, as iOS requires
  const promise = (async () => {
    if (!ac || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return { ok: false, why: 'unsupported' };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      return { ok: false, why: e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'nomic' };
    }
    if (ac.state === 'suspended') await ac.resume().catch(() => {});
    const src = ac.createMediaStreamSource(stream);
    // ScriptProcessor is the one capture node every mobile browser ships; the blocks are tiny.
    const node = ac.createScriptProcessor(2048, 1, 1);
    const sink = ac.createGain();
    sink.gain.value = 0;
    const chunks = [], levels = [];
    const blockSec = 2048 / ac.sampleRate;
    let floor = 0.004, speechAt = -1, lastLoud = -1, t = 0;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        node.onaudioprocess = null;
        try { src.disconnect(); node.disconnect(); sink.disconnect(); } catch { /* already gone */ }
        stream.getTracks().forEach((tr) => tr.stop());
        if (speechAt < 0) return resolve({ ok: false, why: 'nospeech' });
        // keep the speech plus a quarter of a second each side: less audio = faster scoring
        const pad = Math.ceil(0.25 / blockSec);
        const a = Math.max(0, speechAt - pad), b = Math.min(chunks.length, lastLoud + pad + 1);
        const raw = new Float32Array((b - a) * 2048);
        for (let i = a; i < b; i++) raw.set(chunks[i], (i - a) * 2048);
        const pcm = resample(raw, ac.sampleRate);
        resolve({ ok: true, pcm, seconds: pcm.length / RATE });
      };
      stopNow = finish;
      const timer = setTimeout(finish, maxMs);
      node.onaudioprocess = (e) => {
        const x = e.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(x));
        let s = 0;
        for (let i = 0; i < x.length; i++) s += x[i] * x[i];
        const rms = Math.sqrt(s / x.length);
        levels.push(rms);
        if (t * blockSec < 0.25) floor = Math.max(floor, Math.min(0.03, rms * 1.5)); // room noise at the start
        const loud = rms > Math.max(0.012, floor * 2.5);
        if (loud) {
          if (speechAt < 0 && t > 0 && levels[t - 1] > Math.max(0.012, floor * 2.5)) speechAt = t - 1;
          lastLoud = t;
        }
        if (onLevel) onLevel(Math.min(1, rms * 9));
        if (speechAt >= 0 && (t - lastLoud) * blockSec > 1.1) finish();
        t++;
      };
      src.connect(node);
      node.connect(sink);
      sink.connect(ac.destination);
      if (onStart) onStart();
    });
  })();
  return { promise, stop: () => stopNow() };
}

/** 16-bit little-endian PCM, the format the Pro scorer takes. */
export function toPcm16(pcm) {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767)));
  return out;
}
