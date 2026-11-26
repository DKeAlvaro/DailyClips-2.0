// Web tier: the browser's own speech recogniser (Web Speech API). Nothing to download.
import { compare } from './words.js';
import { micStart, micEnd } from './fx.js';

const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition;
export const webSupported = () => !!SR();

/**
 * Listens for one phrase. Returns { promise, stop }.
 * promise -> { ok: true, score, words, heard } or { ok: false, why }
 * why: nospeech | denied | unsupported | network | nomic | error
 * `rare`: indices of the words of `text` that recognisers cannot be trusted with (see words.js).
 */
export function listenWeb(text, { maxMs = 12000, onInterim, onStart, onSpeech, rare = null } = {}) {
  let rec, settled = false, best = null, stopTimer, hardTimer, idleTimer, fail = null;
  const promise = new Promise((resolve) => {
    const finish = (out) => {
      if (settled) return;
      settled = true;
      clearTimeout(stopTimer);
      clearTimeout(hardTimer);
      clearTimeout(idleTimer);
      try {
        rec.onresult = rec.onend = rec.onerror = null;
        rec.abort();
      } catch { /* already stopped */ }
      micEnd();
      resolve(out);
    };
    const wrap = () => (best ? { ok: true, ...best } : { ok: false, why: fail || 'nospeech' });
    micStart();
    try {
      rec = new (SR())();
    } catch {
      micEnd();
      return resolve({ ok: false, why: 'unsupported' });
    }
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.maxAlternatives = 5;
    rec.continuous = true; // a pause between two sentences must not end the take
    rec.onstart = () => onStart && onStart();
    rec.onspeechstart = () => onSpeech && onSpeech();
    rec.onresult = (e) => {
      // Everything heard so far, in order. Repeated or extra words cost nothing in the comparison,
      // so engines that re-send earlier text (Chrome on Android) are harmless.
      const cands = [];
      let joined = '';
      for (let i = 0; i < e.results.length; i++) joined += ' ' + e.results[i][0].transcript;
      cands.push(joined);
      const lastRes = e.results[e.results.length - 1];
      let head = '';
      for (let i = 0; i < e.results.length - 1; i++) head += ' ' + e.results[i][0].transcript;
      for (let a = 1; a < lastRes.length; a++) cands.push(head + ' ' + lastRes[a].transcript);
      for (const c of cands) {
        if (!c.trim()) continue;
        const r = compare(text, c, { rare });
        if (!best || r.score > best.score) best = { ...r, heard: c.trim() };
      }
      if (best && onInterim) onInterim(best);
      clearTimeout(idleTimer);
      if (best && best.score === 100) return api.stop(150);
      // nothing new for a while = the speaker is done
      idleTimer = setTimeout(() => api.stop(400), lastRes.isFinal ? 1300 : 2600);
    };
    rec.onerror = (e) => {
      const map = { 'no-speech': 'nospeech', aborted: 'nospeech', 'audio-capture': 'nomic', 'not-allowed': 'denied',
        'service-not-allowed': 'unsupported', 'language-not-supported': 'unsupported', network: 'network' };
      fail = map[e.error] || 'error';
      if (fail !== 'nospeech') finish(wrap());
    };
    rec.onend = () => finish(wrap());
    try {
      rec.start();
    } catch {
      return finish({ ok: false, why: 'error' });
    }
    stopTimer = setTimeout(() => api.stop(), maxMs);
  });
  const api = {
    promise,
    /** Stops listening; the result arrives through `promise`. `grace` = how long to wait for the engine's last word. */
    stop(grace = 2500) {
      if (settled) return;
      try {
        rec.stop();
      } catch { /* fine */ }
      clearTimeout(hardTimer);
      // some engines never fire `end` after stop(): do not wait for it for long
      hardTimer = setTimeout(() => {
        if (!settled && rec.onend) rec.onend();
      }, grace);
    },
  };
  return api;
}
