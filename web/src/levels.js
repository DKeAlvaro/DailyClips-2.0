// Scoring levels in the UI: the picker (Account, and the "can't listen" help) and the sounds panel in Stats.
import { h, icon, toast } from './dom.js';
import { S, save } from './store.js';
import { t, extend } from './i18n.js';
import { webSupported } from './tier-web.js';
import { device, deviceReady, deviceSupported, proActive } from './tiers.js';
import { proCard } from './billing.js';

extend({
  es: {
    lv_web: 'Web',
    lv_web_sub: 'Nota por palabra con el reconocedor de tu navegador. Nada que descargar.',
    lv_web_off: 'Este navegador no trae reconocedor de voz.',
    lv_dev: 'En el dispositivo',
    lv_dev_sub: 'Nota por sonido: ves qué sonidos fallas. El modelo se baja una vez ({mb} MB) y tu voz no sale del móvil.',
    lv_dev_get: 'Descargar {mb} MB',
    lv_dev_getting: 'Descargando… {p} %',
    lv_dev_remove: 'Borrar la descarga',
    lv_dev_fail: 'No se pudo descargar. Prueba otra vez, mejor con wifi.',
    lv_dev_done: 'Listo. A partir de ahora la nota es por sonido.',
    lv_dev_off: 'Este navegador no puede ejecutar el modelo.',
    lv_on: 'En uso',
    lv_free: 'Gratis',
    lv_use: 'Usar',
    lv_same: 'Todos los niveles puntúan en la misma escala: ninguno da más nota que otro.',
    snd_times: '{n} veces',
  },
  en: {
    lv_web: 'Web',
    lv_web_sub: "Word-by-word score from your browser's recogniser. Nothing to download.",
    lv_web_off: 'This browser has no speech recogniser.',
    lv_dev: 'On this device',
    lv_dev_sub: 'Sound-by-sound score: you see which sounds you miss. The model downloads once ({mb} MB) and your voice stays on the phone.',
    lv_dev_get: 'Download {mb} MB',
    lv_dev_getting: 'Downloading… {p}%',
    lv_dev_remove: 'Remove the download',
    lv_dev_fail: 'The download failed. Try again, ideally on wifi.',
    lv_dev_done: 'Done. Scores are now sound by sound.',
    lv_dev_off: "This browser can't run the model.",
    lv_on: 'In use',
    lv_free: 'Free',
    lv_use: 'Use',
    lv_same: 'Every level scores on the same scale: none of them gives higher marks than another.',
    snd_times: '{n} times',
  },
});

const MODEL_MB = 77;
let downloading = null; // { p } while the model is coming down

function choose(tier, refresh) {
  S.tier = tier;
  save();
  refresh();
}

function deviceCard(refresh) {
  const on = S.tier === 'dev' && deviceReady();
  const card = h('div.tier' + (on ? '.on' : ''),
    h('b', t('lv_dev'), h('em', on ? t('lv_on') : t('lv_free'))),
    h('small', deviceSupported() ? t('lv_dev_sub', { mb: MODEL_MB }) : t('lv_dev_off')));
  if (!deviceSupported()) return card;
  if (downloading) {
    const bar = h('i', { style: { width: Math.round(downloading.p * 100) + '%' } });
    const label = h('small', t('lv_dev_getting', { p: Math.round(downloading.p * 100) }));
    downloading.onProgress = (p) => {
      bar.style.width = Math.round(p * 100) + '%';
      label.textContent = t('lv_dev_getting', { p: Math.round(p * 100) });
    };
    card.append(h('div.prog', bar), label);
  } else if (!deviceReady()) {
    // never downloaded on its own: only this button, which states the size, starts it
    card.append(h('div.btns', { style: { 'margin-top': '12px' } }, h('button.btn.sm.wht', {
      id: 'getmodel',
      onclick: async () => {
        downloading = { p: 0 };
        refresh();
        try {
          const m = await device();
          await m.downloadModel((p) => {
            downloading.p = p;
            if (downloading.onProgress) downloading.onProgress(p);
          });
          S.devModel = true;
          S.tier = 'dev';
          save();
          toast(t('lv_dev_done'));
          m.loadModel().catch(() => {});
        } catch {
          toast(t('lv_dev_fail'));
        }
        downloading = null;
        refresh();
      },
    }, t('lv_dev_get', { mb: MODEL_MB }))));
  } else {
    card.append(h('div.links', { style: { 'justify-content': 'flex-start', 'margin-top': '8px' } },
      on ? null : h('button', { onclick: () => choose('dev', refresh) }, t('lv_use')),
      h('button', {
        onclick: async () => {
          (await device()).removeModel().catch(() => {});
          S.devModel = false;
          if (S.tier === 'dev') S.tier = 'web';
          save();
          refresh();
        },
      }, t('lv_dev_remove'))));
  }
  return card;
}

function webCard(refresh) {
  const ok = webSupported();
  const on = ok && (S.tier === 'web' || (S.tier === 'dev' && !deviceReady()) || (S.tier === 'pro' && !proActive() && !deviceReady()));
  return h(ok && !on ? 'button.tier' : 'div.tier' + (on ? '.on' : ''), { onclick: ok && !on ? () => choose('web', refresh) : null },
    h('b', t('lv_web'), h('em', on ? t('lv_on') : t('lv_free'))),
    h('small', ok ? t('lv_web_sub') : t('lv_web_off')));
}

/** Picker of scoring levels. `only: 'alt'` leaves the web level out (for browsers that lack it). */
export function tierPanel(refresh, { only } = {}) {
  const panel = h('div.blk', h('div.lbl', t('level')));
  if (only !== 'alt') panel.append(webCard(refresh));
  panel.append(deviceCard(refresh), proCard(refresh), h('p.note', t('lv_same')));
  return panel;
}

/** Sounds the user misses most, from the per-sound totals saved with each phoneme-level result. */
export function soundsPanel(list, openLevels) {
  const totals = {};
  for (const r of list) {
    for (const [p, [sum, n]] of Object.entries(r.sounds || {})) {
      const e = totals[p] || (totals[p] = [0, 0]);
      e[0] += sum;
      e[1] += n;
    }
  }
  const rows = Object.entries(totals).filter(([, v]) => v[1] >= 3).map(([p, v]) => ({ p, avg: Math.round(v[0] / v[1]), n: v[1] }))
    .sort((a, b) => a.avg - b.avg).slice(0, 6);
  const panel = h('div.blk', h('div.lbl', t('sounds')));
  if (!rows.length) {
    const any = Object.keys(totals).length > 0;
    panel.append(h('div.lock', icon('lock'), h('div', h('p.sub', { style: { margin: 0 } }, t(any || deviceReady() || proActive() ? 'sounds_empty_short' : 'sounds_lock')),
      !deviceReady() && !proActive() && openLevels ? h('div.links', { style: { 'justify-content': 'flex-start', 'margin-top': '8px' } }, h('button', { onclick: openLevels }, t('sounds_more'))) : null)));
    return panel;
  }
  for (const r of rows) {
    const cls = r.avg >= 80 ? 'good' : r.avg >= 50 ? 'mid' : 'bad';
    panel.append(h('div.snd', h('div', h('div.p', `/${r.p}/`), h('div.ex', t('snd_times', { n: r.n }))),
      h('div.track', h('i', { style: { width: r.avg + '%', background: `var(--${cls})` } })), h('div.v', String(r.avg))));
  }
  return panel;
}
