// Goodness of pronunciation from the frame posteriors of a phoneme CTC model.
// Same maths as scorer/gop.py (the Pro level): keep the two in step.
const BLANK = 0; // <pad>
const NEG = -1e30;
const WINDOW = 2; // frames each side of a phone's first frame

/** Row-wise log-softmax of a [T x V] matrix stored flat. */
export function logSoftmax(data, T, V) {
  const out = new Float32Array(T * V);
  for (let t = 0; t < T; t++) {
    const o = t * V;
    let max = -Infinity;
    for (let v = 0; v < V; v++) if (data[o + v] > max) max = data[o + v];
    let sum = 0;
    for (let v = 0; v < V; v++) sum += Math.exp(data[o + v] - max);
    const lse = max + Math.log(sum);
    for (let v = 0; v < V; v++) out[o + v] = data[o + v] - lse;
  }
  return out;
}

/** CTC forced alignment of the phone ids `seq`. Returns, per frame, the index into seq or -1 (blank). */
export function viterbi(logp, T, V, seq) {
  const U = seq.length, S = 2 * U + 1;
  const path = new Int16Array(T).fill(-1);
  if (T < U || !U) return path;
  let dp = new Float64Array(S).fill(NEG), nx = new Float64Array(S);
  const ptr = new Int8Array(T * S);
  dp[0] = logp[BLANK];
  dp[1] = logp[seq[0]];
  for (let t = 1; t < T; t++) {
    const o = t * V;
    for (let s = 0; s < S; s++) {
      const odd = s & 1, k = (s - 1) >> 1;
      let best = dp[s], arg = 0;
      if (s >= 1 && dp[s - 1] > best) { best = dp[s - 1]; arg = 1; }
      if (odd && s >= 3 && seq[k] !== seq[k - 1] && dp[s - 2] > best) { best = dp[s - 2]; arg = 2; }
      nx[s] = best + logp[o + (odd ? seq[k] : BLANK)];
      ptr[t * S + s] = arg;
    }
    const tmp = dp;
    dp = nx;
    nx = tmp;
  }
  let s = dp[S - 1] >= dp[S - 2] ? S - 1 : S - 2;
  for (let t = T - 1; t >= 0; t--) {
    path[t] = s & 1 ? (s - 1) >> 1 : -1;
    s -= ptr[t * S + s];
  }
  return path;
}

/**
 * Per canonical phone: { gop, heard }. gop = mean log P(expected) - log P(best phone) over the non-blank
 * frames around the phone's first frame (0 = exactly what was expected, more negative = further off).
 */
export function gopRows(logp, T, V, seq, path) {
  const best = new Float32Array(T), bestId = new Int16Array(T), blank = new Uint8Array(T);
  for (let t = 0; t < T; t++) {
    const o = t * V;
    let m = -Infinity, id = 4, top = -Infinity, topId = 0;
    for (let v = 0; v < V; v++) {
      const x = logp[o + v];
      if (x > top) { top = x; topId = v; }
      if (v > 3 && x > m) { m = x; id = v; } // ids 0-3 are <pad> <s> </s> <unk>
    }
    best[t] = m;
    bestId[t] = id;
    blank[t] = topId === BLANK ? 1 : 0;
  }
  const first = new Int32Array(seq.length).fill(-1);
  for (let t = 0; t < T; t++) if (path[t] >= 0 && first[path[t]] < 0) first[path[t]] = t;
  return seq.map((pid, pi) => {
    const t0 = first[pi];
    if (t0 < 0) return { gop: null, heard: null };
    let sum = 0, n = 0, top = t0, topVal = -Infinity;
    for (let t = Math.max(0, t0 - WINDOW); t < Math.min(T, t0 + WINDOW + 1); t++) {
      if (blank[t]) continue;
      sum += logp[t * V + pid] - best[t];
      n++;
      if (best[t] > topVal) { topVal = best[t]; top = t; }
    }
    if (!n) {
      sum = logp[t0 * V + pid] - best[t0];
      n = 1;
    }
    return { gop: sum / n, heard: bestId[top] };
  });
}

/**
 * Share of the phones the model heard that the alignment could not place on any expected phone.
 * Forced alignment only asks "is each expected phone there?", so a longer, different sentence can
 * still land a few lucky phones; whatever was said on top of the line shows up here.
 */
export function extraSpeech(logp, T, V, path) {
  let heard = 0, extra = 0, prev = -1;
  for (let t = 0; t < T; t++) {
    const o = t * V;
    let top = -Infinity, topId = 0, m = -Infinity, id = 4;
    for (let v = 0; v < V; v++) {
      const x = logp[o + v];
      if (x > top) { top = x; topId = v; }
      if (v > 3 && x > m) { m = x; id = v; }
    }
    if (topId === BLANK) { prev = -1; continue; }
    if (id === prev) continue;
    prev = id;
    heard++;
    if (path[t] < 0) extra++;
  }
  return heard ? extra / heard : 0;
}
