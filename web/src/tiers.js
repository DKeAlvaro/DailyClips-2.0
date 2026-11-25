// The three scoring levels behind one interface. All of them return scores on the same 0-100 scale.
//   web  word-level, the browser's own recogniser, nothing to download (default)
//   dev  phoneme-level, a model downloaded once that runs on the phone (free, opt-in)
//   pro  phoneme-level, scored on our server with a larger model (one-time payment)
import { S, save } from './store.js';
import { listenWeb, webSupported } from './tier-web.js';
import { extend, t } from './i18n.js';
import { toast } from './dom.js';

extend({
  es: {
    dev_slow: 'A este móvil le cuesta el modelo: vuelvo al nivel web. Lo puedes reactivar en Cuenta.',
    tip_rare: '<b>{w}</b> · el reconocedor del navegador casi nunca entiende esta palabra: no cuenta para la nota',
  },
  en: {
    dev_slow: 'This phone struggles with the model: back to the web level. You can switch it on again in Account.',
    tip_rare: "<b>{w}</b> · the browser's recogniser hardly ever gets this word: it doesn't count towards your score",
  },
});

const SLOW_MS = 12000; // an on-device score that takes longer than this is not worth the wait
let devModule = null;
/** The on-device code is its own chunk: nobody downloads it until they pick that level. */
export const device = () => devModule || (devModule = import('./tier-device.js'));
let proModule = null;
export const pro = () => proModule || (proModule = import('./tier-pro.js'));

export const proActive = () => !!(S.user && S.user.pro && S.user.pro.active);
export const deviceReady = () => !!S.devModel;
export const deviceSupported = () => typeof WebAssembly === 'object' && !!window.caches && !!window.Worker && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

/** Which level a take will actually use: the chosen one if it is available, otherwise the best fallback. */
export function activeTier(unit) {
  const phones = !unit || !!unit.ph;
  if (S.tier === 'pro' && proActive() && phones && !proDown()) return 'pro';
  if ((S.tier === 'dev' || S.tier === 'pro') && deviceReady() && phones) return 'dev';
  if (webSupported()) return 'web';
  if (deviceReady() && phones) return 'dev';
  if (proActive() && phones) return 'pro';
  return 'web';
}

export const canListen = () => webSupported() || deviceReady() || proActive();

// When the Pro queue is full the app stops asking for a little while and uses what the device has.
let proBusyUntil = 0;
const proDown = () => Date.now() < proBusyUntil;

/** Get the heavy parts ready before the first take (model in memory, chunk loaded). */
export function warm(unit) {
  const tier = activeTier(unit);
  if (tier === 'dev') device().then((m) => m.loadModel()).catch(() => {});
  if (tier === 'pro') pro().catch(() => {});
}

/**
 * Listens to one phrase with the active level.
 * Returns { promise, stop, tier }; promise -> { ok, score, words, tier, ... } | { ok: false, why }
 */
export function listen(unit, hooks) {
  const tier = activeTier(unit);
  if (tier === 'web') {
    const h = listenWeb(unit.text, { ...hooks, rare: unit.rare });
    return { stop: h.stop, tier, promise: h.promise.then((r) => ({ ...r, tier })) };
  }
  let inner = null, stopped = false;
  const promise = (async () => {
    try {
      const m = await (tier === 'pro' ? pro() : device());
      inner = tier === 'pro' ? m.listenPro(unit, hooks) : m.listenDevice(unit, hooks);
    } catch {
      return { ok: false, why: 'model' };
    }
    if (stopped) inner.stop();
    let r = await inner.promise;
    if (!r.ok && tier === 'pro' && ['busy', 'limit', 'nopro', 'error'].includes(r.why) && r.pcm) {
      // Pro could not take it: never queue more work there, score with what this device has
      if (r.why === 'nopro') {
        if (S.user && S.user.pro) S.user.pro.active = false;
      } else proBusyUntil = Date.now() + 20000;
      if (deviceReady()) {
        try {
          const d = await device();
          return { ok: true, ...(await d.scoreAudio(unit, r.pcm)), tier: 'dev', fellBack: r.why };
        } catch { /* fall through */ }
      }
      return { ok: false, why: 'pro_' + r.why };
    }
    if (!r.ok && r.why === 'model' && tier === 'dev') {
      S.devModel = false; // cache evicted or broken download: back to the web level until it is fetched again
      save();
    }
    if (r.pcm) r = { ...r, pcm: undefined };
    if (r.ok && tier === 'dev' && r.ms > SLOW_MS && webSupported()) {
      // waiting this long for every line is worse than a word-level score: say so and step down
      S.tier = 'web';
      save();
      toast(t('dev_slow'), 5000);
    }
    return { ...r, tier };
  })();
  return { tier, promise, stop: () => { stopped = true; if (inner) inner.stop(); } };
}
