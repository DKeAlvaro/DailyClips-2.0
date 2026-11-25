// Phoneme-level scoring shared by the on-device and Pro levels, mapped onto the common 0-100 scale.
//
// The scale is the web level's: share of words understood. On the reference audios (tests/ref) the web
// level gives native speech 100, Spanish-accented speech 77 and a different sentence 8. Each phoneme
// model is pinned to those three points, so no level hands out higher scores than another.
import { band } from './words.js';

export const CAL = {
  // k: how fast a phone's score falls as its goodness of pronunciation drops
  // pts: [raw score of the model, common-scale score] for another sentence, Spanish accent, native
  dev: { k: 10, pts: [[0.25, 8], [0.58, 77], [0.78, 100]] },
  pro: { k: 10, pts: [[0.24, 8], [0.56, 77], [0.88, 100]] },
};

/** Piecewise-linear map through the calibration points, clamped to 0-100. */
export function toScale(raw, pts) {
  let a = pts[0], b = pts[1];
  for (let i = 1; i < pts.length - 1 && raw > pts[i][0]; i++) {
    a = pts[i];
    b = pts[i + 1];
  }
  const v = a[1] + ((raw - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
  return Math.max(0, Math.min(100, Math.round(v)));
}

const phoneScore = (gop, k) => (gop == null ? 0 : Math.max(0, Math.min(1, 1 + gop / k)));

/**
 * unit: the clip's phrase ({ text, ph: [[phones of word 1], ...], m: { dev: "1101..", pro: ".." } })
 * rows: per canonical phone, in order: { gop, heard } (heard = phone symbol the model liked best)
 * extra: share of what was heard that is not part of the phrase (0 when the take is just the phrase)
 * Phones the native reference itself does not hit (mask "0") are shown but not counted.
 */
export function scorePhrase(unit, rows, tier, extra = 0) {
  const cal = CAL[tier];
  const mask = (unit.m && unit.m[tier]) || '';
  const texts = unit.text.split(/\s+/).filter(Boolean);
  let k = 0, total = 0, counted = 0;
  const words = unit.ph.map((phones, wi) => {
    let sum = 0, n = 0;
    const ph = phones.map((p) => {
      const row = rows[k] || { gop: null, heard: null };
      const on = mask[k] !== '0';
      k++;
      const raw = phoneScore(row.gop, cal.k);
      if (on) { sum += raw; n++; }
      return { p, s: on ? toScale(raw, cal.pts) : null, h: row.heard && row.heard !== p ? row.heard : null };
    });
    total += sum;
    counted += n;
    const s = n ? toScale(sum / n, cal.pts) : null;
    return { t: texts[wi] || '', s, c: s == null ? 'g' : band(s), ph };
  });
  return { score: counted ? toScale((total / counted) * (1 - extra), cal.pts) : 0, words };
}
