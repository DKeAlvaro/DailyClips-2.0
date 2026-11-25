// The three scoring levels behind one interface. All of them return scores on the same 0-100 scale.
import { S } from './store.js';
import { listenWeb, webSupported } from './tier-web.js';

/** Which level will actually be used right now (falls back when the chosen one is not available). */
export function activeTier() {
  return 'web';
}

export const canListen = () => webSupported();

/**
 * Listens to one phrase with the active level.
 * Returns { promise, stop, tier }; promise -> { ok, score, words, heard?, tier } | { ok: false, why }
 */
export function listen(unit, hooks) {
  const tier = activeTier();
  const handle = listenWeb(unit.text, hooks);
  return { ...handle, tier, promise: handle.promise.then((r) => ({ ...r, tier })) };
}

/** Per-sound totals of a finished session, for the stats of the phoneme levels. */
export function soundTotals() {
  return S.tier === 'web' ? null : null;
}
