// Her voice: short recorded reactions, fetched on demand and played on an <audio> element (see fx.js).
//   say('take_great', { onTalk: (on) => talking(el, on) })  ->  { promise, stop }
import { S } from './store.js';
import { playUrl } from './fx.js';
import { lang } from './i18n.js';

/** Lines per moment, in the order of tools/voice/lines.json (tools/voice/check.mjs keeps them equal). */
export const COUNTS = {
  take_perfect: 12, take_great: 12, take_good: 10, take_close: 12, take_low: 10, take_better: 8, take_silent: 4,
  result_high: 8, result_mid: 6, result_low: 5, result_best: 4, streak: 6, bye: 3,
};

/** Her tips after a take, by issue (see sounds.js): two lines each, in English (fix_) and in Spanish (es_fix_). */
export const FIXES = ['th_d', 'th', 'v', 'z', 'h', 'sh', 'j', 'ng', 'r', 'er', 'w', 'y', 'i', 'ee', 'ae', 'uh', 'schwa', 'ah', 'aw',
  'oo', 'u', 'oh', 'ay', 'flap', 'end', 'es', 'vowel', 'cons', 'missed'];
for (const k of FIXES) COUNTS['fix_' + k] = COUNTS['es_fix_' + k] = 2;

/** The moment of her tip for an issue, in the language of the interface (null when she has none). */
export const fixMoment = (issue) => (FIXES.includes(issue) ? (lang() === 'es' ? 'es_fix_' : 'fix_') + issue : null);

const file = (m, n) => `/assets/voice1/${m}-${n}.mp3`;
const VOLUME = 0.9;
const GAP = 350; // ms between two lines of sayAll()

const files = new Map(); // url -> Promise<blob URL | null>, for the session
const recent = {}; // moment -> numbers said lately, newest last
const ready = {}; // moment -> number picked ahead by warm()
let line = null; // the line playing now
let turn = 0; // bumped by say() and hush(): a sayAll() that sees it change stops

const quiet = () => ({ promise: Promise.resolve(false), stop() {} });

function pick(m) {
  const n = COUNTS[m], last = recent[m] || (recent[m] = []);
  const avoid = last.slice(-Math.min(3, n - 1));
  const pool = [];
  for (let i = 1; i <= n; i++) if (!avoid.includes(i)) pool.push(i);
  const i = pool[Math.floor(Math.random() * pool.length)];
  last.push(i);
  if (last.length > 3) last.shift();
  return i;
}

function load(url) {
  let p = files.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then((b) => URL.createObjectURL(new Blob([b], { type: 'audio/mpeg' })))
      .catch(() => {
        files.delete(url); // offline or missing: try again next time
        return null;
      });
    files.set(url, p);
  }
  return p;
}

/**
 * Says one line of a moment. index: 0-based line of that moment (else a random one that was not
 * said lately). Resolves true when it played to the end, false when silent, stopped or failed.
 * wait: ms from now before she may start (the file is fetched meanwhile; hush() cancels the wait).
 * The first argument may also be an item of resultMoments(): { moment, index }.
 */
export function say(moment, { index, onTalk, wait = 0 } = {}) {
  if (moment && typeof moment === 'object') ({ moment, index = index } = moment);
  line?.stop();
  turn++;
  const n = COUNTS[moment];
  if (!S.sound || !n) return quiet();
  let num;
  if (index != null) num = Math.max(1, Math.min(n, (index | 0) + 1));
  else if (ready[moment]) num = ready[moment];
  else num = pick(moment);
  delete ready[moment];

  let src = null, timer = 0, over = false, talk = false, done;
  const promise = new Promise((r) => (done = r));
  const finish = (ok) => {
    if (over) return;
    over = true;
    clearTimeout(timer);
    src?.stop();
    if (talk) onTalk?.(false);
    if (line === me) line = null;
    done(ok);
  };
  const me = { promise, stop: () => finish(false) };
  line = me;
  const from = Date.now();

  const start = (url) => {
    if (over) return;
    if (!S.sound) return finish(false);
    src = playUrl('voice', url, {
      volume: VOLUME,
      onStart: () => {
        talk = true;
        onTalk?.(true);
      },
      onEnd: finish,
    });
    // the element ends by itself; this only frees her if the browser never says so
    timer = setTimeout(() => finish(true), 15000);
  };
  load(file(moment, num)).then((url) => {
    if (over) return;
    if (!url) return finish(false);
    const left = wait - (Date.now() - from);
    if (left > 0) timer = setTimeout(() => start(url), left);
    else start(url);
  });
  return me;
}

/** Says several lines one after the other (e.g. resultMoments()). Same options as say(); wait only delays the first. */
export function sayAll(list, opts = {}) {
  let cur = null, stopped = false;
  const promise = (async () => {
    for (const [i, it] of list.entries()) {
      if (stopped) return false;
      cur = say(it, i ? { ...opts, wait: 0 } : opts);
      const t = turn;
      await cur.promise;
      if (t !== turn) return false;
      await new Promise((r) => setTimeout(r, GAP));
      if (t !== turn || stopped) return false;
    }
    return true;
  })();
  return { promise, stop: () => { stopped = true; cur?.stop(); } };
}

/** Stops whatever she is saying (call it when the video resumes or the mic opens). */
export function hush() {
  turn++;
  line?.stop();
}

/** Optional: picks and downloads the next line of these moments ahead, so say() starts at once. */
export function warm(...moments) {
  if (!S.sound) return;
  for (const m of moments) {
    if (!COUNTS[m]) continue;
    ready[m] ||= pick(m);
    load(file(m, ready[m]));
  }
}

/**
 * The moment for a take. score 0-100; previous: score of the last take of the same line (or null);
 * heard: false when the recogniser got nothing.
 */
export function takeMoment({ score, previous = null, heard = true }) {
  if (!heard) return 'take_silent';
  if (previous != null && score < 100 && score - previous >= 10) return 'take_better';
  return score >= 100 ? 'take_perfect' : score >= 85 ? 'take_great' : score >= 70 ? 'take_good' : score >= 50 ? 'take_close' : 'take_low';
}

const STREAK = { 2: 0, 3: 1, 5: 2, 7: 3, 10: 4 };

/**
 * What to say on the result screen, in order (at most two): [{ moment, index? }].
 * best: the personal best before this clip (null if none); streak: the streak this clip just
 * reached (0 if it did not move it). Pass the list to sayAll(), or each item to say().
 */
export function resultMoments({ score, best = null, streak = 0 }) {
  const out = [{ moment: best != null && score > best ? 'result_best' : score >= 85 ? 'result_high' : score >= 60 ? 'result_mid' : 'result_low' }];
  const i = STREAK[streak] ?? (streak > 10 && streak % 10 === 0 ? COUNTS.streak - 1 : null);
  if (i != null) out.push({ moment: 'streak', index: i });
  return out;
}

const MOOD = {
  take_perfect: 'wow', take_great: 'happy', take_good: 'happy', take_close: 'almost', take_low: 'oops', take_better: 'happy',
  take_silent: 'listen', result_high: 'wow', result_mid: 'happy', result_low: 'almost', result_best: 'wow', streak: 'wow', bye: 'happy',
};

/** The mascot's mood for a moment (or an item of resultMoments()). */
export const moodFor = (m) => MOOD[m?.moment || m] || 'idle';
