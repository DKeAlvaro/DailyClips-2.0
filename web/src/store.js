// Local-first state: everything works without the server and syncs when it can.
const KEY = 'dailyclips.v2';

function randomToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const fresh = () => ({
  token: randomToken(),
  lang: null, // null = follow the browser
  tier: 'web', // web | dev | pro
  devModel: false, // the on-device model has been downloaded into this browser
  sound: true,
  user: null, // server profile of a signed-in user
  results: {}, // clip n -> { id?, n, score, phrases, tier, day, at, onDay, synced, sounds? }
  session: null, // an unfinished clip: { n, best: [], takes: [] }
  seen: {}, // one-off hints already shown
  mascot: 'a', // which look of the mascot: a (drawn) | b (pictures), set with ?mascot=
});

let state = fresh();
try {
  const raw = localStorage.getItem(KEY);
  if (raw) state = { ...fresh(), ...JSON.parse(raw) };
} catch { /* private mode: keep in memory */ }

export const S = state;

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch { /* quota or private mode */ }
}
save();

export function resetIdentity() {
  const keep = { lang: state.lang, sound: state.sound };
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, fresh(), keep);
  save();
}

const pad = (n) => String(n).padStart(2, '0');
export function addDays(day, n) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const resultList = () => Object.values(state.results).sort((a, b) => a.n - b.n);

/** Streak from the local history: consecutive release days done on their day. */
export function streak(today) {
  const days = new Set(resultList().filter((r) => r.onDay).map((r) => r.day));
  let d = days.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (days.has(d)) {
    current++;
    d = addDays(d, -1);
  }
  let best = 0, run = 0, prev = null;
  for (const x of [...days].sort()) {
    run = prev && addDays(prev, 1) === x ? run + 1 : 1;
    best = Math.max(best, run);
    prev = x;
  }
  return { current, best, today: days.has(today), days };
}

/** Replaces local history with the server's view, keeping local results that never got uploaded. */
export function applyProfile(p) {
  if (!p) return;
  state.user = p.user || null;
  const merged = {};
  for (const r of p.results || []) merged[r.n] = { ...r, synced: true };
  for (const r of Object.values(state.results)) if (!merged[r.n] && !r.synced) merged[r.n] = r;
  state.results = merged;
  save();
}
