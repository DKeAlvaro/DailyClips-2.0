// Scoring levels in the UI: the picker in Account and the "sounds you miss" panel in Stats.
import { h, icon } from './dom.js';
import { t } from './i18n.js';

const nothing = () => document.createDocumentFragment();

/** Picker of scoring levels. Until the phoneme levels ship there is nothing to choose. */
export function tierPanel() {
  return nothing();
}

/** Sounds the user misses most, from the per-sound totals saved with each result. */
export function soundsPanel(list) {
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
  const panel = h('div.panel', h('h3', t('sounds')));
  if (!rows.length) {
    panel.append(h('div.lock', icon('lock'), h('p.sub', { style: { margin: 0 } }, t('sounds_lock'))));
    return panel;
  }
  for (const r of rows) {
    const cls = r.avg >= 80 ? 'good' : r.avg >= 50 ? 'mid' : 'bad';
    panel.append(h('div.snd', h('div', h('div.p', `/${r.p}/`), h('div.ex', t('times', { n: r.n }))),
      h('div.track', h('i', { style: { width: r.avg + '%', background: `var(--${cls})` } })), h('div.v', String(r.avg))));
  }
  return panel;
}
