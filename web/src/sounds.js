// English sounds told with letters and example words, never phonetic symbols. Every sound the models
// score belongs to an issue: what tends to go wrong with it and how to fix it. The issue also names
// her spoken tip for it (voice1/fix_<issue>-n.mp3, see voice.js).
import { spellOut } from './spell.js';
import { band } from './words.js';
import { extend, t, esc } from './i18n.js';

// sound -> [issue, the letters that usually spell it, an example word]
const SOUND = {
  ð: ['th_d', 'th', 'this'], θ: ['th', 'th', 'think'], v: ['v', 'v', 'very'], z: ['z', 'z', 'zoo'], h: ['h', 'h', 'house'],
  ʃ: ['sh', 'sh', 'she'], ʒ: ['sh', 's', 'vision'], dʒ: ['j', 'j', 'job'], ŋ: ['ng', 'ng', 'sing'], w: ['w', 'w', 'we'], j: ['y', 'y', 'yes'],
  ɹ: ['r', 'r', 'red'], ɑːɹ: ['r', 'ar', 'car'], ɔːɹ: ['r', 'or', 'more'], oːɹ: ['r', 'our', 'four'], ɛɹ: ['r', 'air', 'air'],
  ɪɹ: ['r', 'ere', 'here'], ʊɹ: ['r', 'ure', 'sure'], aɪɚ: ['r', 'ire', 'fire'], ɚ: ['er', 'er', 'her'], ɜː: ['er', 'ir', 'bird'],
  ɪ: ['i', 'i', 'ship'], ᵻ: ['i', 'i', 'ship'], iː: ['ee', 'ee', 'sheep'], i: ['ee', 'y', 'happy'],
  æ: ['ae', 'a', 'cat'], a: ['ae', 'a', 'cat'], ʌ: ['uh', 'u', 'cup'], ɐ: ['uh', 'u', 'cup'], ə: ['schwa', 'a', 'about'], əl: ['schwa', 'le', 'little'],
  ɑː: ['ah', 'a', 'father'], ɑ: ['ah', 'a', 'father'], ɔː: ['aw', 'ough', 'thought'], ɔ: ['aw', 'a', 'all'],
  uː: ['oo', 'oo', 'food'], u: ['oo', 'oo', 'food'], ju: ['oo', 'ou', 'you'], ʊ: ['u', 'oo', 'book'],
  oʊ: ['oh', 'o', 'go'], əʊ: ['oh', 'o', 'go'], eɪ: ['ay', 'ay', 'day'], ɾ: ['flap', 't', 'water'],
  ɛ: ['vowel', 'e', 'bed'], ɒ: ['vowel', 'o', 'hot'], aɪ: ['vowel', 'y', 'my'], aʊ: ['vowel', 'ow', 'now'], ɔɪ: ['vowel', 'oy', 'boy'],
  iə: ['vowel', 'ere', 'here'], eə: ['vowel', 'air', 'hair'], aɪə: ['vowel', 'ire', 'fire'],
  p: ['cons', 'p', 'pen'], b: ['cons', 'b', 'boy'], t: ['cons', 't', 'top'], d: ['cons', 'd', 'dog'], k: ['cons', 'k', 'kit'],
  ɡ: ['cons', 'g', 'go'], f: ['cons', 'f', 'fun'], s: ['cons', 's', 'sun'], m: ['cons', 'm', 'man'], n: ['cons', 'n', 'no'],
  l: ['cons', 'l', 'love'], ts: ['cons', 'ts', 'its'], tʃ: ['cons', 'ch', 'chair'],
};
const VOWEL = new Set(['ɪ', 'ᵻ', 'iː', 'i', 'æ', 'a', 'ʌ', 'ɐ', 'ə', 'əl', 'ɑː', 'ɑ', 'ɔː', 'ɔ', 'uː', 'u', 'ju', 'ʊ', 'oʊ', 'əʊ', 'eɪ', 'ɛ', 'e', 'o',
  'ɒ', 'aɪ', 'aʊ', 'ɔɪ', 'iə', 'eə', 'aɪə', 'ɚ', 'ɜː', 'ɑːɹ', 'ɔːɹ', 'oːɹ', 'ɛɹ', 'ɪɹ', 'ʊɹ', 'aɪɚ']);
// Spanish sounds the models know, as a Spanish speaker would write them
const LOOKS = { x: 'j', r: 'rr', β: 'b', ɣ: 'g', ʝ: 'y', ɲ: 'ñ', e: 'e', o: 'o', a: 'a' };
// the row the "sounds you miss" panel shows for an issue: letters and example
const LABEL = { r: ['r', 'red'], er: ['ir', 'bird'], i: ['i', 'ship'], ee: ['ee', 'sheep'], ae: ['a', 'cat'], uh: ['u', 'cup'],
  schwa: ['a', 'about'], ah: ['a', 'father'], aw: ['ough', 'thought'], oo: ['oo', 'food'], sh: ['sh', 'she'] };


extend({
  es: {
    snd_heard: 'La {l} sonó a «{h}».',
    snd_like: 'La {l} sonó como en <i>{x}</i>.',
    snd_should: 'Aquí la {l} suena como en <i>{x}</i>.',
    snd_unclear: 'La {l} no salió clara.',
    snd_end: 'No se oyó la {l} del final.',
    snd_es: 'Sin «e» delante: «{w}», no «e{w}».',
    snd_copy: 'Escucha el clip otra vez y cópiala.',
    how_th_d: 'Punta de la lengua entre los dientes, con voz: no es una d.',
    how_th: 'Lengua entre los dientes y sopla, como la z de España.',
    how_v: 'Dientes de arriba sobre el labio de abajo, y que vibre: no es una b.',
    how_z: 'Es una s que zumba, como una abeja.',
    how_h: 'Solo un soplo suave, como al empañar un cristal; no es la j.',
    how_sh: 'Como cuando mandas callar: shh, con los labios redondos.',
    how_j: 'Como una ch pero con voz, la de <i>job</i>.',
    how_ng: 'Una n hecha atrás, en la garganta; la g no se dice.',
    how_r: 'La lengua se curva hacia atrás sin tocar nada; no vibra.',
    how_er: 'Ni e ni o: lengua recogida hacia atrás, como en <i>bird</i>.',
    how_w: 'Labios redondos, como una u rápida.',
    how_y: 'Como una i rápida y suave.',
    how_i: 'Corta y floja, casi una e: <i>ship</i>, no <i>sheep</i>.',
    how_ee: 'Larga y tensa, sonriendo: <i>sheep</i>, no <i>ship</i>.',
    how_ae: 'Muy abierta, entre a y e: baja la mandíbula.',
    how_uh: 'Una a corta y floja, sin abrir mucho, como en <i>cup</i>.',
    how_schwa: 'Floja y rapidísima, casi no se dice.',
    how_ah: 'Una a larga y abierta, como en <i>father</i>.',
    how_aw: 'Una o abierta y larga, con los labios algo redondos.',
    how_oo: 'Una u larga, con los labios bien redondos.',
    how_u: 'Una u corta y floja, como en <i>book</i>.',
    how_oh: 'La o acaba en u: «ou», como en <i>go</i>.',
    how_ay: 'La a acaba en i: «ei», como en <i>day</i>.',
    how_flap: 'Entre vocales suena suave, como la r de «pero».',
    how_end: 'No te la comas: que se oiga.',
  },
  en: {
    snd_heard: 'The {l} sounded like "{h}".',
    snd_like: 'The {l} sounded like in <i>{x}</i>.',
    snd_should: 'Here the {l} sounds like in <i>{x}</i>.',
    snd_unclear: "The {l} didn't come out clearly.",
    snd_end: "The final {l} wasn't heard.",
    snd_es: 'No "e" in front: "{w}", not "e{w}".',
    snd_copy: 'Listen to the clip again and copy it.',
    how_th_d: 'Tongue tip between your teeth, with voice: not a d.',
    how_th: 'Tongue between your teeth and blow, no voice.',
    how_v: 'Top teeth on your bottom lip, and buzz: not a b.',
    how_z: 'An s that buzzes, like a bee.',
    how_h: 'Just a soft breath, like fogging up a window.',
    how_sh: 'Like telling someone to hush: shh, with round lips.',
    how_j: 'Like ch, but with voice, as in <i>job</i>.',
    how_ng: 'An n made at the back of the mouth; no g at the end.',
    how_r: "Curl your tongue back without touching anything; don't roll it.",
    how_er: 'Not e, not o: tongue pulled back, as in <i>bird</i>.',
    how_w: 'Round lips, like a quick oo.',
    how_y: 'Like a quick, soft ee.',
    how_i: 'Short and relaxed, almost an e: <i>ship</i>, not <i>sheep</i>.',
    how_ee: 'Long and tense, smiling: <i>sheep</i>, not <i>ship</i>.',
    how_ae: 'Wide open, between a and e: drop your jaw.',
    how_uh: 'A short, relaxed uh, as in <i>cup</i>.',
    how_schwa: 'Weak and quick, almost silent.',
    how_ah: 'A long, open ah, as in <i>father</i>.',
    how_aw: 'A long, open o with rounded lips.',
    how_oo: 'A long oo with rounded lips.',
    how_u: 'A short, relaxed u, as in <i>book</i>.',
    how_oh: 'The o glides into oo: "oh-oo", as in <i>go</i>.',
    how_ay: 'The a glides into ee: "ay", as in <i>day</i>.',
    how_flap: 'Between vowels it is a quick tap, almost a d.',
    how_end: "Don't swallow it: let it be heard.",
  },
});

/** The issue of sound `k` of a word with these sounds; `heard`: what the model heard there, if anything. */
function issueAt(phones, k, heard) {
  const p = phones[k];
  const key = SOUND[p] ? SOUND[p][0] : VOWEL.has(p) ? 'vowel' : 'cons';
  if (key !== 'cons') return key;
  if (p === 's' && k === 0 && phones[1] && !VOWEL.has(phones[1])) return 'es'; // "stare" said "estare"
  // a last consonant that came out as nothing (or as a vowel) was swallowed
  if (k === phones.length - 1 && k > 0 && (!heard || VOWEL.has(heard))) return 'end';
  return 'cons';
}

/** A heard sound in a learner's terms: { l: letters } for consonants and Spanish sounds, { x: example } for English vowels. */
function looks(h) {
  if (LOOKS[h]) return { l: LOOKS[h] };
  const s = SOUND[h];
  if (!s) return null;
  return VOWEL.has(h) ? { x: s[2] } : { l: s[1] };
}

/** Index of the first sound of `word` that the recogniser heard differently ("this" heard as "dis": the th). */
function diffAt(word, heard, chunks) {
  const at = []; // letter of the word -> sound index
  for (const c of chunks) for (const ch of c.t) if (/[a-z]/i.test(ch)) at.push(c.p.length ? c.p[0] : null);
  const a = word.toLowerCase().replace(/[^a-z]/g, ''), b = heard.toLowerCase().replace(/[^a-z]/g, '');
  const n = a.length, m = b.length;
  if (!n || !m || at.length !== n) return null;
  // d[i][j] = edits between a[i..] and b[j..]; walk from the start to the first edit
  const d = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === n ? m - j : j === m ? n - i : 0)));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) d[i][j] = Math.min(d[i + 1][j] + 1, d[i][j + 1] + 1, d[i + 1][j + 1] + (a[i] === b[j] ? 0 : 1));
  if (d[0][0] > 2 && 1 - d[0][0] / Math.max(n, m) < 0.4) return null; // a different word altogether: nothing to point at
  let i = 0, j = 0;
  while (i < n && j < m && a[i] === b[j] && d[i][j] === d[i + 1][j + 1]) { i++; j++; }
  for (let x = Math.min(i, n - 1); x >= 0; x--) if (at[x] != null) return at[x];
  return null;
}

/** The word with its letters coloured by how each sound came out; the letters of sound `focus` underlined. */
function spelled(word, chunks, w, focus) {
  if (!chunks) return `<b>${esc(word)}</b>`;
  return '<b class="sp">' + chunks.map((c) => {
    const ss = w.ph ? c.p.map((i) => w.ph[i] && w.ph[i].s).filter((v) => v != null) : [];
    const cls = [ss.length ? band(Math.min(...ss)) : '', focus != null && c.p.includes(focus) ? 'f' : ''].join(' ').trim();
    return cls ? `<span class="${cls}">${esc(c.t)}</span>` : esc(c.t);
  }).join('') + '</b>';
}

/**
 * What to tell about word `w` of a result (words.js or phon.js) whose sounds are `phones`.
 * Returns { key, head, body }: the issue to speak about (null when there is nothing to fix), the word
 * with its letters coloured, and one or two sentences in plain words (null when there is no sound to point at).
 */
export function explain(w, phones) {
  const word = w.t.replace(/^[^\w']+|[^\w']+$/g, '');
  const chunks = phones && phones.length ? spellOut(word, phones) : null;
  let k = null, heard = null;
  if (w.ph) {
    // phoneme levels: the worst sound of the word, if one stands out
    const bad = w.ph.map((x, i) => ({ ...x, i })).filter((x) => x.s != null && x.s < 80).sort((a, b) => a.s - b.s)[0];
    if (bad) ({ i: k, h: heard } = bad);
  } else if (w.heard && chunks && w.c !== 'g') k = diffAt(word, w.heard, chunks);
  const head = spelled(word, chunks, w, k);
  if (k == null) return { key: w.c === 'g' || w.s == null ? null : w.ph ? 'cons' : 'missed', head, body: null };
  const key = issueAt(phones, k, heard);
  const own = chunks && chunks.find((c) => c.p.includes(k));
  const letters = own ? own.t.toLowerCase() : SOUND[phones[k]] ? SOUND[phones[k]][1] : '?';
  const l = `<b class="${w.ph ? band(w.ph[k].s) : w.c}">${esc(letters)}</b>`;
  let body;
  if (key === 'es') body = t('snd_es', { w: word.toLowerCase() });
  else {
    const seen = w.ph && heard && heard !== phones[k] ? looks(heard) : null;
    const ex = SOUND[phones[k]] && SOUND[phones[k]][2];
    // read as it is written ("is" said with an s): say what it sounds like here instead
    const said = seen && seen.l === letters && ex && ex !== word.toLowerCase() ? t('snd_should', { x: ex })
      : seen && seen.l && seen.l !== letters ? t('snd_heard', { h: seen.l }) : seen && seen.x && seen.x !== word.toLowerCase() ? t('snd_like', { x: seen.x }) : null;
    body = (said || t(key === 'end' ? 'snd_end' : 'snd_unclear')).replace('{l}', l) + ' ' + t(key === 'cons' || key === 'vowel' ? 'snd_copy' : 'how_' + key);
  }
  return { key, head, body };
}

/** The "sounds you miss" rows: totals per sound ({ sound: [sum, n] }) merged into what a learner sees. */
export function soundRows(totals) {
  const rows = new Map();
  for (const [p, [sum, n]] of Object.entries(totals)) {
    const s = SOUND[p];
    if (!s) continue; // a sound outside English: nothing to show for it
    const id = s[0] === 'cons' || s[0] === 'vowel' ? p : s[0];
    const [letters, ex] = LABEL[id] || [s[1], s[2]];
    const r = rows.get(id) || { letters, ex, sum: 0, n: 0 };
    r.sum += sum;
    r.n += n;
    rows.set(id, r);
  }
  return [...rows.values()].map((r) => ({ ...r, avg: Math.round(r.sum / r.n) }));
}
