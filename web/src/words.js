// Word-level comparison between what the phrase says and what the recogniser heard.

const SAME = [
  ['to', 'too', 'two'], ['there', 'their', 'theyre'], ['your', 'youre'], ['for', 'four'], ['know', 'no'],
  ['right', 'write'], ['here', 'hear'], ['by', 'buy', 'bye'], ['won', 'one'], ['see', 'sea'], ['be', 'bee'],
  ['our', 'hour'], ['whos', 'whose'], ['its'], ['ok', 'okay'], ['im', 'am'], ['whether', 'weather'],
  ['hi', 'high'], ['new', 'knew'], ['would', 'wood'], ['wait', 'weight'], ['made', 'maid'], ['through', 'threw'],
  ['meet', 'meat'], ['son', 'sun'], ['week', 'weak'], ['peace', 'piece'], ['whole', 'hole'], ['ill', 'isle'],
  ['lil', 'little'], ['ol', 'old'], ['nothin', 'nothing'], ['somethin', 'something'], ['goin', 'going'], ['doin', 'doing'],
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

/**
 * Rough sound of a word: its consonant skeleton with look-alike spellings folded together, so that
 * "jazzercise", "jazzer size" and "jazz or size" all come out the same.
 */
export function soundKey(w) {
  let s = w.toLowerCase().replace(/[^a-z]/g, '');
  s = s.replace(/^kn/, 'n').replace(/^wr/, 'r').replace(/^wh/, 'w').replace(/ph/g, 'f').replace(/ght/g, 't').replace(/gh/g, '')
    .replace(/[ts]ion/g, 'Sn').replace(/tch|ch/g, 'C').replace(/sh/g, 'S').replace(/th/g, 'T').replace(/ck/g, 'k')
    .replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/q/g, 'k').replace(/x/g, 'ks').replace(/z/g, 's').replace(/dg/g, 'j');
  const head = /^[aeiou]/.test(s) ? 'a' : s[0] || '';
  return (head + s.slice(1).replace(/[aeiouyhw]/g, '')).replace(/(.)\1+/g, '$1');
}

const near = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);

/** 1 = same word (or a homophone), 0.5 = close, 0 = different. */
export function sim(e, h) {
  if (e === h) return 1;
  if (CLASS.has(e) && CLASS.get(e) === CLASS.get(h)) return 1;
  if (spell(e) === spell(h)) return 1;
  if (e.length >= 7 && h.length >= 6 && soundKey(e) === soundKey(h)) return 1; // a long word the engine spelled its own way
  const strip = (w) => w.replace(/(s|ed|d|ing|es)$/, '');
  if (e.length > 3 && h.length > 3 && strip(e) === strip(h)) return 0.5;
  const L = Math.max(e.length, h.length);
  if (L >= 4 && 1 - lev(e, h) / L >= 0.6) return 0.5;
  return 0;
}

/** One expected word against several heard ones: recognisers split words they do not know ("jazz or size"). */
function simSplit(e, run) {
  const joined = run.join('');
  if (joined === e || spell(joined) === spell(e)) return 1;
  return e.length >= 6 && soundKey(joined) === soundKey(e) ? 1 : 0;
}

/**
 * A rare word (a brand, a made-up word, an unusual name) is something recognisers replace with common
 * words even when it is said well. Anything that roughly sounds like it is taken as said.
 */
function simRare(e, run) {
  const a = soundKey(e), b = soundKey(run.join(''));
  return a.length >= 2 && b.length >= 2 && near(a, b) >= 0.6 ? 1 : 0;
}

/**
 * Indices of the words of `text` a recogniser cannot be trusted with: the clip's rare words plus names
 * (a capital letter inside a sentence: "Lil Sebastian", "Dwight"), which recognisers spell their own way.
 */
export function untrusted(text, rare) {
  const out = new Set(rare || []);
  const words = String(text).split(/\s+/).filter(Boolean);
  words.forEach((w, i) => {
    if (i && /^[^\w]*[A-Z][a-z]/.test(w) && !/[.!?:]["”’')]*$/.test(words[i - 1])) out.add(i);
  });
  return [...out];
}

const RUN = 3; // how many words may stand for one

/**
 * Aligns the heard tokens against the expected ones (order matters) and returns, per display word,
 * a credit in [0,1] and what was heard in its place.
 * `rare`: indices of display words that recognisers cannot be trusted with. They are never held
 * against the speaker: said (or nearly) = good, anything else = not counted (score null).
 */
export function compare(expectedText, heardText, { rare = null } = {}) {
  const E = tokens(expectedText), H = tokens(heardText);
  const n = E.toks.length, m = H.toks.length;
  const isRare = rare && rare.length ? E.map.map((wi) => rare.includes(wi)) : null;
  // credit of expected token i-1 when it takes the r heard tokens ending at j
  const take = (i, j, r) => {
    const e = E.toks[i - 1], run = H.toks.slice(j - r, j);
    const c = r === 1 ? sim(e, run[0]) : simSplit(e, run);
    return c < 1 && isRare && isRare[i - 1] && simRare(e, run) ? 1 : c;
  };
  // credit per expected token when the r expected tokens ending at i were heard as one word ("ice cream" -> "icecream")
  const merge = (i, j, r) => {
    const joined = E.toks.slice(i - r, i).join(''), h = H.toks[j - 1];
    return joined === h || spell(joined) === spell(h) || (joined.length >= 6 && soundKey(joined) === soundKey(h)) ? 1 : 0;
  };
  // dp[i][j] = best total credit aligning E[0..i) with H[0..j); bt: 0 skip expected, 1 skip heard, 10+r take r, 20+r merge r
  const dp = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  const bt = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let best = dp[i - 1][j], k = 0;
      if (dp[i][j - 1] > best) { best = dp[i][j - 1]; k = 1; }
      for (let r = 1; r <= RUN && r <= j; r++) {
        const v = dp[i - 1][j - r] + take(i, j, r);
        if (v > best || (r === 1 && v === best)) { best = v; k = 10 + r; }
      }
      for (let r = 2; r <= RUN && r <= i; r++) {
        const c = merge(i, j, r);
        if (c && dp[i - r][j - 1] + r * c > best) { best = dp[i - r][j - 1] + r * c; k = 20 + r; }
      }
      dp[i][j] = best;
      bt[i][j] = k;
    }
  }
  const credit = new Array(n).fill(0), heard = new Array(n).fill(null);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const k = bt[i][j];
    if (k === 0) i--;
    else if (k === 1) j--;
    else if (k < 20) {
      const r = k - 10;
      credit[i - 1] = take(i, j, r);
      heard[i - 1] = H.toks.slice(j - r, j).join(' ');
      i--; j -= r;
    } else {
      const r = k - 20;
      for (let x = 1; x <= r; x++) credit[i - x] = 1;
      i -= r; j--;
    }
  }
  const words = E.words.map((w) => ({ t: w, credit: 0, k: 0, heard: [] }));
  E.toks.forEach((_, ti) => {
    const w = words[E.map[ti]];
    w.credit += credit[ti];
    w.k++;
    if (heard[ti] && credit[ti] < 1) w.heard.push(heard[ti]);
  });
  const spoken = words.filter((w) => w.k);
  // a line made only of rare words still has to be judged on something
  const lenient = rare && rare.length && spoken.some((w, wi) => !rare.includes(words.indexOf(w)));
  let total = 0, counted = 0;
  words.forEach((w, wi) => {
    if (!w.k) { w.c = 'g'; w.s = null; delete w.k; delete w.credit; w.heard = null; return; } // punctuation-only token
    w.credit /= w.k;
    w.heard = w.heard.join(' ') || null;
    if (lenient && rare.includes(wi) && w.credit < 0.99) {
      w.rare = true; // not understood, and not this speaker's fault: shown as neutral, left out of the score
      w.s = null;
      w.c = 'n';
    } else {
      w.s = Math.round(w.credit * 100);
      w.c = w.credit >= 0.99 ? 'g' : w.credit >= 0.4 ? 'c' : 'm';
      total += w.credit;
      counted++;
    }
    delete w.k;
    delete w.credit;
  });
  return { score: counted ? Math.round((total / counted) * 100) : 0, words };
}

export const band = (s) => (s >= 80 ? 'g' : s >= 50 ? 'c' : 'm');
