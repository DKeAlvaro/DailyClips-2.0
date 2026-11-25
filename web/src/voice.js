// Her voice: short recorded reactions, fetched on demand and played through the app's AudioContext.
//   say('take_great', { onTalk: (on) => talking(el, on) })  ->  { promise, stop }
import { S } from './store.js';
import { audioContext } from './fx.js';

/** Lines per moment, in the order of tools/voice/lines.json (tools/voice/check.mjs keeps them equal). */
export const COUNTS = {
  take_perfect: 12, take_great: 12, take_good: 10, take_close: 12, take_low: 10, take_better: 8, take_silent: 4,
  result_high: 8, result_mid: 6, result_low: 5, result_best: 4, streak: 6, bye: 3,
};

const file = (m, n) => `/assets/voice1/${m}-${n}.mp3`;
const VOLUME = 0.9;
const GAP = 350; // ms between two lines of sayAll()

const buffers = new Map(); // url -> Promise<AudioBuffer | null>, for the session
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

function load(url, a) {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then((b) => new Promise((ok, no) => a.decodeAudioData(b, ok, no))) // callback form: old Safari has no promise
      .catch(() => {
        buffers.delete(url); // offline or missing: try again next time
        return null;
      });
    buffers.set(url, p);
  }
  return p;
}

/**
 * Says one line of a moment. index: 0-based line of that moment (else a random one that was not
 * said lately). Resolves true when it played to the end, false when silent, stopped or failed.
 * The first argument may also be an item of resultMoments(): { moment, index }.
 */
export function say(moment, { index, onTalk } = {}) {
  if (moment && typeof moment === 'object') ({ moment, index = index } = moment);
  line?.stop();
  turn++;
  const n = COUNTS[moment];
  const a = S.sound && n ? audioContext() : null;
  if (!a) return quiet();
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
    if (src) try { src.stop(); } catch { /* not started */ }
    if (talk) onTalk?.(false);
    if (line === me) line = null;
    done(ok);
  };
  const me = { promise, stop: () => finish(false) };
  line = me;

  load(file(moment, num), a).then((buf) => {
    if (over) return;
    if (!buf || !S.sound) return finish(false);
    if (a.state !== 'running') a.resume().catch(() => {});
    src = a.createBufferSource();
    src.buffer = buf;
    const g = a.createGain();
    g.gain.value = VOLUME;
    src.connect(g).connect(a.destination);
    src.onended = () => finish(true);
    src.start();
    talk = true;
    onTalk?.(true);
    // a suspended context never fires onended: give up a little after the line's length
    timer = setTimeout(() => finish(true), buf.duration * 1000 + 700);
  });
  return me;
}

/** Says several lines one after the other (e.g. resultMoments()). Same options as say(). */
export function sayAll(list, opts = {}) {
  let cur = null, stopped = false;
  const promise = (async () => {
    for (const it of list) {
      if (stopped) return false;
      cur = say(it, opts);
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
  const a = S.sound ? audioContext() : null;
  if (!a) return;
  for (const m of moments) {
    if (!COUNTS[m]) continue;
    ready[m] ||= pick(m);
    load(file(m, ready[m]), a);
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
