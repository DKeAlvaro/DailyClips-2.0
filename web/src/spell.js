// Letter-to-sound aligner: which letters of a word spell each espeak phone, so the UI can colour letters
// instead of showing IPA. Dynamic programming over (letter, phone): listed spellings are free, the rest costs.

// phone: common spellings | rare ones. "/" shares a line, "a+b" = one spelling for two phones.
const TABLE = `
p: p
b: b
t: t ed | th pt
d: d ed
ɾ: t d
k: c k ck ch q qu cq | kh que
ɡ: g gu gh | gue
tʃ: ch tch tu ti | t c
dʒ: j g dg dge | d di
f: f ph gh
v: v | f ph
θ: th
ð: th
s: s c ss sc ce se | ps z x
z: s z | x es
ʃ: sh ti ci ssi si sci ch s | ce c
ʒ: s si g ge | z j su
h: h wh
m: m
n: n kn gn | pn mn
ŋ: ng n
l/ɫ: l
ʔ: t
ɹ: r wr rh
w: w wh u | o
j: y i | u j
ts: ts tz | tes
k+s: x cc xc
ɡ+z: x
k+w: qu
s+k: sch sc
w+ʌ/w+ɒ: o
j+uː: u ew eu ue iew eau
j+ʊ/j+ə/j+ʊɹ: u
tʃ+uː/tʃ+ʊ/tʃ+ə: tu
ᵻ+z/ɪ+z: es
ɪ/ᵻ: i e y ui ie | a u o ai ei ee ey ea
iː: ee ea e ie ei ey i eo | y ae oe ay eau
i: y ey ie ee e i ea | ay ei ai
ɛ: e ea a ai ay ie | u eo ei ae
æ/a: a | ai au
ɑː: a o ar ah | au ea er
ɒ: o a ou | ow au
ɔː/ɔ: o a au aw ou ough augh or ore oar oor our ar oa | oo
ʌ: u o ou oo oe | a
ə/ɐ: a e i o u ou er or ar ur our re ure ir | y r ai ei eo ia io ea ough
ʊ: u oo ou oul | o
uː: oo u ue ew ou o ui ough | oe eu iew
ju: u ew you yu eu ue iew eau | ui
aɪ: i y igh ie eye uy ye ig | ei ai ui eigh ay
eɪ: a ai ay ei ey ea eigh aigh | au ae
oʊ/əʊ: o oa ow oe ou ough oh | ew eau oo au
aʊ: ou ow | ough au
ɔɪ: oi oy | uoy
iə: ear eer ere ier ea ia io ie eo | eir
ɪɹ: ear eer ere ier ir eir er | ea
ɛɹ/eə: air are ere ear eir ar er err aer eyre | ayer
ʊɹ: our oor ure ur oure
ɔːɹ/oːɹ: or ore oar oor our ar | aur oure
ɑːɹ: ar are ear | arr er
ɚ/ɝ/ɜː: er ir ur or ear our ar yr | r re ure
əl: le al el il ol ul l ll
aɪɚ/aɪə: ire ier yer ir iar ia io ie | yre
`;

const SP = new Map(); // "phone" or "phone+phone" -> [[spelling, cost], ...]
for (const line of TABLE.trim().split('\n')) {
  const [keys, rest] = line.split(': ');
  const [common, rare = ''] = rest.split(' | ');
  for (const key of keys.split('/')) {
    const list = SP.get(key) || SP.set(key, []).get(key);
    for (const s of common.split(' ')) {
      list.push([s, 0]);
      // doubled consonants spell the same sound: tt, ll, ss...
      if (s.length === 1 && !key.includes('+') && !'aeiouy'.includes(s)) list.push([s + s, 0]);
    }
    for (const s of rare.split(' ')) if (s) list.push([s, 0.8]);
  }
}

const VOWEL = /[aeiouæɛɪʊʌəɚɜɑɔɒɐᵻ]/;
const base = (c) => c.normalize('NFD')[0].toLowerCase();

/** Is `t` (any case, apostrophes ignored) a listed spelling of these phones? */
export function isKnown(t, phones) {
  const s = t.toLowerCase().replace(/['’]/g, '');
  return (SP.get(phones.join('+')) || []).some(([x]) => x === s);
}

/**
 * Chunks covering `word` exactly, [{ t: "th", p: [0] }, ...], p = indices into `phones` (punctuation: []).
 * null for digits or a clearly bad alignment.
 */
export function spellOut(word, phones) {
  if (!phones.length || /\d/.test(word)) return null;
  // letters only: pos = index in word, part = hyphen/slash-separated piece (apostrophes stay inside a piece)
  const L = [], pos = [], part = [];
  let gap = false;
  for (let k = 0; k < word.length; k++) {
    const c = base(word[k]);
    if (/[a-z]/.test(c)) {
      part.push((part[part.length - 1] || 0) + (gap && L.length ? 1 : 0));
      L.push(c);
      pos.push(k);
      gap = false;
    } else if (!/['’ʼ]/.test(c)) gap = true;
  }
  const N = L.length, m = phones.length, W = m + 1, s = L.join('');
  if (!N) return null;
  const same = (i, n) => part[i] === part[i + n - 1];
  const end = (i) => i + 1 === N || part[i + 1] !== part[i];

  // cost of leaving letter i silent, a phone without letters, a lone unlisted letter
  const silent = (i) => {
    const c = s[i], p = s[i - 1], n = s[i + 1];
    if (c === 'e') return end(i) || (end(i + 1) && 'sd'.includes(n)) ? 0.4 : 1;
    if ((c === 'l' && 'aou'.includes(p) && 'kmfd'.includes(n)) || (c === 'b' && (p === 'm' || n === 't'))) return 0.3;
    return 'aiouy'.includes(c) ? 1.5 : 1;
  };
  const loose = (ph) => (/^[əɪᵻɐ]/.test(ph) ? 1.8 : VOWEL.test(ph) ? 3 : 3.5);
  const unlisted = (ph, c) => (VOWEL.test(ph) ? ('aeiouy'.includes(c) ? 1.5 : 5) : 'aeiouy'.includes(c) ? 5 : 3);

  const cost = new Float64Array((N + 1) * W).fill(Infinity), from = [];
  cost[0] = 0;
  const relax = (i, j, c, pi, pj, kind) => {
    if (c < cost[i * W + j] - 1e-9) [cost[i * W + j], from[i * W + j]] = [c, [pi, pj, kind]];
  };
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= m; j++) {
      const c = cost[i * W + j];
      if (c === Infinity) continue;
      if (i < N) relax(i + 1, j, c + silent(i), i, j, 's');
      if (j < m) relax(i, j + 1, c + loose(phones[j]), i, j, 'l');
      for (let k = 1; k <= 2 && j + k <= m && i < N; k++) {
        for (const [sp, sc] of SP.get(phones.slice(j, j + k).join('+')) || []) {
          if (s.startsWith(sp, i) && same(i, sp.length)) relax(i + sp.length, j + k, c + sc + (k - 1) * 0.1, i, j, 'm');
        }
        if (k === 1) relax(i + 1, j + 1, c + unlisted(phones[j], s[i]), i, j, 'm');
      }
    }
  }
  if (cost[N * W + m] > 4 + 0.2 * N) return null;

  // backtrace into segments: letters [a, b) spell phones p; kind m = match, s = silent letters, l = loose phone
  const segs = [];
  for (let i = N, j = m; i || j; ) {
    const [pi, pj, kind] = from[i * W + j];
    segs.unshift({ a: pi, b: i, kind, p: Array.from({ length: j - pj }, (_, x) => pj + x) });
    [i, j] = [pi, pj];
  }
  // silent letters join the previous chunk (the next one at the start of a piece); a loose vowel joins the
  // next chunk, a loose consonant the previous
  const near = (q, dir) => {
    for (q += dir; segs[q]; q += dir) if (segs[q].kind === 'm') return segs[q];
  };
  segs.forEach((x, q) => {
    if (x.kind === 'm') return;
    const letters = x.b > x.a, fwd = !letters && VOWEL.test(phones[x.p[0]]);
    for (const dir of fwd ? [1, -1] : [-1, 1]) {
      const y = near(q, dir);
      if (!y || (letters && part[x.a] !== part[dir < 0 ? y.b - 1 : y.a])) continue;
      if (letters) [y.a, y.b] = [Math.min(y.a, x.a), Math.max(y.b, x.b)];
      y.p = y.p.concat(x.p).sort((u, v) => u - v);
      x.gone = true;
      return;
    }
  });
  // chunks, with whatever sits between the letters (hyphens, apostrophes, quotes) as p: [] chunks
  const out = [];
  let last = 0;
  for (const x of segs) {
    if (x.gone) continue;
    if (x.b === x.a) return null;
    const t0 = pos[x.a], t1 = pos[x.b - 1] + 1;
    if (t0 > last) out.push({ t: word.slice(last, t0), p: [] });
    out.push({ t: word.slice(t0, t1), p: x.p });
    last = t1;
  }
  if (last < word.length) out.push({ t: word.slice(last), p: [] });
  return out;
}
