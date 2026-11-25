// Pro level: the take is sent to our server, scored there with a larger phoneme model and discarded.
// Nothing to download and no work for the phone. Needs an active subscription.
import { record, toPcm16 } from './rec.js';
import { scorePhrase } from './phon.js';
import { api } from './api.js';
import { ctx } from './ctx.js';

export function listenPro(unit, { maxMs, onLevel, onScoring } = {}) {
  const rec = record({ maxMs: Math.min(maxMs || 12000, 14000), onLevel });
  const promise = (async () => {
    const r = await rec.promise;
    if (!r.ok) return r;
    if (onScoring) onScoring();
    const t0 = performance.now();
    try {
      const out = await api(`/api/pro/score?n=${ctx.clip.n}&p=${unit.idx}`, {
        method: 'POST', raw: true, body: toPcm16(r.pcm).buffer, headers: { 'Content-Type': 'application/octet-stream' }, timeout: 25000,
      });
      return { ok: true, ...scorePhrase(unit, out.rows, 'pro', out.extra || 0), ms: Math.round(performance.now() - t0), serverMs: out.ms, seconds: r.seconds };
    } catch (e) {
      // 503 = queue full, 429 = personal limit, 402/403 = no subscription. The caller falls back with the audio.
      const why = e.status === 503 ? 'busy' : e.status === 429 ? 'limit' : e.status === 402 || e.status === 403 ? 'nopro' : 'error';
      return { ok: false, why, pcm: r.pcm };
    }
  })();
  return { promise, stop: rec.stop };
}
