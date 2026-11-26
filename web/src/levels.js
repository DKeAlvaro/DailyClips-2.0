// Scoring levels in the UI: the picker (Account, and the "can't listen" help) and the sounds panel in Stats.
import { h, icon, toast } from './dom.js';
import { S, save } from './store.js';
import { t, extend } from './i18n.js';
import { webSupported } from './tier-web.js';
import { device, deviceReady, deviceSupported, proActive } from './tiers.js';
import { proCard } from './billing.js';
import { ctx } from './ctx.js';
import { soundRows } from './sounds.js';

extend({
  es: {
    lv_web: 'Web',
    lv_web_sub: 'Nota por palabra. Nada que descargar.',
    lv_web_off: 'Este navegador no trae reconocedor de voz.',
    lv_dev: 'En el dispositivo',
    lv_dev_sub: 'Nota por sonido. Tu voz no sale del móvil.',
    lv_dev_get: 'Descargar {mb} MB',
    lv_dev_getting: 'Descargando… {p} %',
    lv_dev_remove: 'Borrar la descarga',
    lv_dev_fail: 'No se pudo descargar. Prueba otra vez, mejor con wifi.',
    lv_dev_done: 'Listo. A partir de ahora la nota es por sonido.',
    lv_dev_off: 'Este navegador no puede ejecutar el modelo.',
    lv_on: 'En uso',
    lv_free: 'Gratis',
    lv_use: 'Usar',
  },
  en: {
    lv_web: 'Web',
    lv_web_sub: 'Word-by-word score. Nothing to download.',
    lv_web_off: 'This browser has no speech recogniser.',
    lv_dev: 'On this device',
    lv_dev_sub: 'Sound-by-sound score. Your voice stays on the phone.',
    lv_dev_get: 'Download {mb} MB',
    lv_dev_getting: 'Downloading… {p}%',
    lv_dev_remove: 'Remove the download',
    lv_dev_fail: 'The download failed. Try again, ideally on wifi.',
    lv_dev_done: 'Done. Scores are now sound by sound.',
    lv_dev_off: "This browser can't run the model.",
    lv_on: 'In use',
    lv_free: 'Free',
    lv_use: 'Use',
  },
});

const MODEL_MB = 77;
// 'Free' only says something next to a paid level
const tag = (on) => (on ? h('em', t('lv_on')) : ctx.cfg.pro && ctx.cfg.pro.enabled ? h('em', t('lv_free')) : null);
let downloading = null; // { p } while the model is coming down

function choose(tier, refresh) {
  S.tier = tier;
  save();
  refresh();
}

function deviceCard(refresh) {
  const on = S.tier === 'dev' && deviceReady();
  const card = h('div.tier' + (on ? '.on' : ''),
    h('b', t('lv_dev'), tag(on)),
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
    h('b', t('lv_web'), tag(on)),
    h('small', ok ? t('lv_web_sub') : t('lv_web_off')));
}

/** Picker of scoring levels. `only: 'alt'` leaves the web level out (for browsers that lack it). */
export function tierPanel(refresh, { only } = {}) {
  const panel = h('div.blk', h('div.lbl', t('level')));
  if (only !== 'alt') panel.append(webCard(refresh));
  panel.append(deviceCard(refresh), proCard(refresh));
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
  const rows = soundRows(totals).filter((r) => r.n >= 3).sort((a, b) => a.avg - b.avg).slice(0, 6);
  const locked = !rows.length && !Object.keys(totals).length && !deviceReady() && !proActive();
  if (locked) {
    // the web level cannot tell sounds apart: one row that leads to the levels that can
    return h('div.blk', h('button.set.locked', { onclick: openLevels }, h('div', icon('lock'), t('sounds')), icon('next')));
  }
  const panel = h('div.blk', h('div.lbl', t('sounds')));
  if (!rows.length) {
    panel.append(h('p.sub', { style: { margin: 0 } }, t('sounds_empty_short')));
    return panel;
  }
  for (const r of rows) {
    const cls = r.avg >= 80 ? 'good' : r.avg >= 50 ? 'mid' : 'bad';
    // the sound as the letters that spell it and a word that has it: "th this"
    panel.append(h('div.snd', h('div.p', h('b', r.letters), h('i', r.ex)),
      h('div.track', h('i', { style: { width: r.avg + '%', background: `var(--${cls})` } })), h('div.v', String(r.avg))));
  }
  return panel;
}
