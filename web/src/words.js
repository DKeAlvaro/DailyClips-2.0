// Word-level comparison between what the phrase says and what the recogniser heard.

const SAME = [
  ['to', 'too', 'two'], ['there', 'their', 'theyre'], ['your', 'youre'], ['for', 'four'], ['know', 'no'],
  ['right', 'write'], ['here', 'hear'], ['by', 'buy', 'bye'], ['won', 'one'], ['see', 'sea'], ['be', 'bee'],
  ['our', 'hour'], ['whos', 'whose'], ['its'], ['ok', 'okay'], ['im', 'am'], ['whether', 'weather'],
  ['hi', 'high'], ['new', 'knew'], ['would', 'wood'], ['wait', 'weight'], ['made', 'maid'], ['through', 'threw'],
  ['meet', 'meat'], ['son', 'sun'], ['week', 'weak'], ['peace', 'piece'], ['whole', 'hole'], ['ill', 'isle'],
];
const CLASS = new Map();
SAME.forEach((g, i) => g.forEach((w) => CLASS.set(w, i)));

const EXPAND = {
  gonna: ['going', 'to'], wanna: ['want', 'to'], gotta: ['got', 'to'], kinda: ['kind', 'of'], sorta: ['sort', 'of'],
  lemme: ['let', 'me'], gimme: ['give', 'me'], dunno: ['dont', 'know'], cuz: ['because'], cause: ['because'], cos: ['because'],
  mr: ['mister'], mrs: ['missus'], dr: ['doctor'], vs: ['versus'], alright: ['all', 'right'], cannot: ['can', 'not'],
  ya: ['you'], yall: ['you', 'all'], em: ['them'], til: ['until'], till: ['until'], yeah: ['yes'], yep: ['yes'], yup: ['yes'],
};

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

export function numberWords(n) {
  if (n < 20) return [ONES[n]];
  if (n < 100) return [TENS[Math.floor(n / 10)], ...(n % 10 ? [ONES[n % 10]] : [])];
  if (n < 1000) return [ONES[Math.floor(n / 100)], 'hundred', ...(n % 100 ? numberWords(n % 100) : [])];
  if (n < 1e6) return [...numberWords(Math.floor(n / 1000)), 'thousand', ...(n % 1000 ? numberWords(n % 1000) : [])];
  if (n < 1e9) return [...numberWords(Math.floor(n / 1e6)), 'million', ...(n % 1e6 ? numberWords(n % 1e6) : [])];
  return [String(n)];
}

const ORD = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };

/** 100 -> ["hundredth"], 21 -> ["twenty", "first"]: ordinals the way people say them. */
export function ordinalWords(n) {
  let w = numberWords(n);
  if (w.length === 2 && w[0] === 'one' && ['hundred', 'thousand', 'million'].includes(w[1])) w = [w[1]];
  const last = w[w.length - 1];
  w[w.length - 1] = ORD[last] || (last.endsWith('y') ? last.slice(0, -1) + 'ieth' : last + 'th');
  return w;
}

/** Same word in British and American spelling -> same key (colour/color, travelled/traveled, realise/realize). */
const spell = (w) => (w.length < 5 ? w : w.replace(/our(s|ed|ing|ite|ites)?$/, 'or$1').replace(/ll(ed|ing|er|ers)$/, 'l$1')
  .replace(/is(e|es|ed|ing|ation)$/, 'iz$1').replace(/ys(e|es|ed|ing)$/, 'yz$1').replace(/tre(s)?$/, 'ter$1').replace(/ogue(s)?$/, 'og$1'));

/** Text -> comparable tokens. `map[i]` is the index of the display word each token came from. */
export function tokens(text) {
  const out = [], map = [];
  const words = String(text).replace(/[‘’]/g, "'").split(/\s+/).filter(Boolean);
  words.forEach((raw, wi) => {
    for (let part of raw.split(/[-–—/]+/)) {
      let extra = null;
      if (/^\$/.test(part)) extra = 'dollars';
      if (/%$/.test(part)) extra = 'percent';
      const clock = /^(\d{1,2}):(\d{2})\D*$/.exec(part); // "4:30" is how recognisers write "four thirty"
      part = part.toLowerCase().replace(/[^a-z0-9']/g, '');
      if (!part) continue;
      const bare = part.replace(/'/g, '');
      let toks;
      if (clock) toks = [...numberWords(Number(clock[1])), ...(Number(clock[2]) ? numberWords(Number(clock[2])) : ['oclock'])];
      else if (/^\d+$/.test(bare)) toks = numberWords(Number(bare));
      else if (/^\d+(st|nd|rd|th)$/.test(bare)) toks = ordinalWords(parseInt(bare, 10));
      else if (/^\d+s$/.test(bare)) toks = [...numberWords(parseInt(bare, 10)), 's'];
      else toks = EXPAND[bare] || [bare];
      if (extra) toks = [...toks, extra];
      for (const t of toks) {
        out.push(t);
        map.push(wi);
      }
    }
  });
  return { toks: out, map, words };
}

function lev(a, b) {
  const n = a.length, m = b.length;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[m];
}

/** 1 = same word (or a homophone), 0.5 = close, 0 = different. */
export function sim(e, h) {
  if (e === h) return 1;
  if (CLASS.has(e) && CLASS.get(e) === CLASS.get(h)) return 1;
  if (spell(e) === spell(h)) return 1;
  const strip = (w) => w.replace(/(s|ed|d|ing|es)$/, '');
  if (e.length > 3 && h.length > 3 && strip(e) === strip(h)) return 0.5;
  const L = Math.max(e.length, h.length);
  if (L >= 4 && 1 - lev(e, h) / L >= 0.6) return 0.5;
  return 0;
}

/**
 * Aligns the heard tokens against the expected ones (order matters) and returns, per display word,
 * a credit in [0,1] and what was heard in its place.
 */
export function compare(expectedText, heardText) {
  const E = tokens(expectedText), H = tokens(heardText);
  const n = E.toks.length, m = H.toks.length;
  // dp[i][j] = best total credit aligning E[0..i) with H[0..j)
  const dp = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  const bt = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = dp[i - 1][j - 1] + sim(E.toks[i - 1], H.toks[j - 1]);
      let best = d, k = 0;
      if (dp[i - 1][j] > best) { best = dp[i - 1][j]; k = 1; }
      if (dp[i][j - 1] > best) { best = dp[i][j - 1]; k = 2; }
      dp[i][j] = best;
      bt[i][j] = k;
    }
  }
  const credit = new Array(n).fill(0), heard = new Array(n).fill(null);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const k = bt[i][j];
    if (k === 0) {
      credit[i - 1] = sim(E.toks[i - 1], H.toks[j - 1]);
      heard[i - 1] = H.toks[j - 1];
      i--; j--;
    } else if (k === 1) i--;
    else j--;
  }
  const words = E.words.map((w) => ({ t: w, credit: 0, k: 0, heard: [] }));
  E.toks.forEach((_, ti) => {
    const w = words[E.map[ti]];
    w.credit += credit[ti];
    w.k++;
    if (heard[ti] && credit[ti] < 1) w.heard.push(heard[ti]);
  });
  let total = 0, counted = 0;
  for (const w of words) {
    if (!w.k) { w.c = 'g'; w.s = null; continue; } // punctuation-only token
    w.credit /= w.k;
    w.s = Math.round(w.credit * 100);
    w.c = w.credit >= 0.99 ? 'g' : w.credit >= 0.4 ? 'c' : 'm';
    w.heard = w.heard.join(' ') || null;
    total += w.credit;
    counted++;
    delete w.k;
    delete w.credit;
  }
  return { score: counted ? Math.round((total / counted) * 100) : 0, words };
}

export const band = (s) => (s >= 80 ? 'g' : s >= 50 ? 'c' : 'm');
