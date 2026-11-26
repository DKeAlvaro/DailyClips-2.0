// Invented players. A board that three people have played reads as a dead product, so a few dozen
// made-up accounts play along: same alias, same skill and the same appetite for playing on every run,
// so the weekly board shows regulars and a streak can look like one.
//
// They are ordinary users and ordinary results (users.seed = 1 marks them), so the counts, the
// rankings and the weekly board keep one code path. Only the admin sees which rows are invented
// (DC_ADMIN_EMAILS), and remove() takes them all out again.
import { aliasFrom, randomId } from './util.mjs';

const BASE = 20261126;      // fixed: rerunning never reshuffles who the players are
const FIRST_PLAY_H = 0.6;   // people start playing about half an hour after the clip is out
const LAST_PLAY_H = 20;     // ... and the last of the day late in the evening
const MAX_DAY = 140;        // a busy day never goes past this

/** mulberry32: small, fast, and the same numbers for the same seed on every machine. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bytes = (r) => [Math.floor(r() * 256), Math.floor(r() * 256), Math.floor(r() * 256)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Roughly normal, mean 0 and sd 1 (Box-Muller). */
function gauss(r) {
  return Math.sqrt(-2 * Math.log(Math.max(r(), 1e-9))) * Math.cos(2 * Math.PI * r());
}

/** The invented player at index i, always the same one: alias, usual score and how often they play. */
function player(i, salt = 0) {
  const r = rng(BASE + i * 7919 + salt * 104729);
  return {
    alias: aliasFrom(bytes(r)),
    skill: 56 + r() * 30,      // their usual score
    sd: 8 + r() * 4,           // how much a good or a bad day moves it
    plays: 0.3 + r() * 0.62,   // how often they turn up
  };
}

/** How many people a day would have played: a slow ramp from the first clip, with gentle waves. */
function target(n) {
  const d = n - 1;
  return Math.max(9, Math.min(MAX_DAY, 12 + 5 * d + Math.round(3 * Math.sin(d * 1.3 + 0.4))));
}

/**
 * Who plays that clip and in what order they arrive. Some invented players turn up most days and
 * others once in a while, so the weekly board gets its regulars. Sorted by arrival, earliest first:
 * a day that is still going only has the ones whose time has come.
 */
function attendance(n, want, pool) {
  const shuffle = rng(BASE + 31 * n);
  const order = Array.from({ length: pool }, (_, i) => i)
    .map((i) => [shuffle(), i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const seats = order.filter((i) => rng(BASE + 977 * n + i * 13)() < player(i).plays);
  for (const i of order) if (seats.length < want && !seats.includes(i)) seats.push(i);
  return seats.slice(0, want)
    .map((i) => ({ i, arrival: Math.pow(rng(BASE + 5011 * n + i * 7)(), 0.8) })) // most play in the afternoon
    .sort((a, b) => a.arrival - b.arrival);
}

/** Their score on that clip. Everyone is worse on the first days of the product, and some have a bad day. */
function takeScore(i, n, r) {
  const p = player(i);
  const first = n <= 2 ? 5 : 0;
  const off = r() < 0.07 ? 9 + r() * 12 : 0;
  return clamp(Math.round(p.skill - first - off + gauss(r) * p.sd), 3, 100);
}

/** One score per line whose mean is the score, the same rounding the API does to a real take. */
function phraseScores(score, lines, r) {
  const out = Array.from({ length: lines }, () => clamp(Math.round(score + gauss(r) * 9), 0, 100));
  const room = (i, up) => (up ? out[i] < 100 : out[i] > 0);
  for (let guard = 0; guard < 2000; guard++) {
    const sum = out.reduce((a, v) => a + v, 0);
    if (Math.round(sum / lines) === score) return out;
    const up = sum / lines < score;
    const free = out.map((_, i) => i).filter((i) => room(i, up));
    if (!free.length) break;
    out[free[Math.floor(r() * free.length)]] += up ? 1 : -1;
  }
  return out.fill(score);
}

const linesOf = (json) => JSON.parse(json).phrases.filter((p) => !p.skip).length;

export function createSeed({ q, tx, log = () => {} }) {
  /** The invented accounts, index i being player(i); created once and reused from then on. */
  function pool(players, dry) {
    const rows = q('SELECT id, alias FROM users WHERE seed = 1 ORDER BY id').all();
    if (dry) {
      // a dry run counts what it would do without writing the accounts first
      while (rows.length < players) rows.push({ id: -1 - rows.length, alias: player(rows.length).alias });
      return rows;
    }
    const taken = new Set(rows.map((r) => r.alias.toLowerCase()));
    while (rows.length < players) {
      const i = rows.length;
      let salt = 0;
      let p = player(i);
      while (taken.has(p.alias.toLowerCase())) p = player(i, ++salt);
      taken.add(p.alias.toLowerCase());
      let id = null;
      for (let tries = 0; id == null && tries < 5; tries++) {
        const r = q('INSERT INTO users (pub, created_at, alias, is_test, seed) VALUES (?, ?, ?, 0, 1)')
          .run(randomId(10), Date.now(), p.alias);
        id = r.lastInsertRowid;
      }
      rows.push({ id, alias: p.alias });
    }
    return rows;
  }

  /**
   * Adds the takes that are due, never one in the future. `live` only looks at today's clip (a cron
   * every half hour fills the day as it goes), `today` sets how many play today, `days` how far back
   * it backfills and `players` how many invented accounts exist. Never twice the same take: the
   * results table keeps one per player and clip.
   */
  function run({ live = false, today = null, days = 90, players = 60, dry = false } = {}) {
    const now = Date.now();
    const all = q('SELECT n, day, published_at, json FROM clips ORDER BY n DESC').all();
    if (!all.length) return { added: 0, accounts: 0, days: [] };
    const todayN = all[0].n;
    const accounts = pool(Math.max(players, 12), dry);
    const scope = (live ? all.slice(0, 1) : all.slice(0, days)).reverse();
    let added = 0;
    const done = [];
    for (const clip of scope) {
      const want = Math.min(clip.n === todayN && today != null ? today : target(clip.n), accounts.length, MAX_DAY);
      if (!want) continue;
      const have = new Set(q('SELECT user_id FROM results WHERE clip_n = ? AND user_id IN (SELECT id FROM users WHERE seed = 1)')
        .all(clip.n).map((r) => r.user_id));
      const start = (clip.published_at || now) + FIRST_PLAY_H * 3600e3;
      const span = (LAST_PLAY_H - FIRST_PLAY_H) * 3600e3;
      const lines = linesOf(clip.json);
      let made = 0;
      for (const seat of attendance(clip.n, want, accounts.length)) {
        const user = accounts[seat.i];
        if (have.has(user.id)) continue;
        const at = Math.round(start + (0.03 + 0.9 * seat.arrival) * span);
        if (at > now) continue; // still to come today: a later run adds it
        const score = takeScore(seat.i, clip.n, rng(BASE + 6151 * clip.n + seat.i));
        const roll = rng(BASE + 8111 * clip.n + seat.i)();
        const tier = roll < 0.05 ? 'pro' : roll < 0.2 ? 'dev' : 'web'; // most people use the browser level
        made += dry ? 1 : q(`INSERT OR IGNORE INTO results (pub, user_id, clip_n, score, phrases, tier, on_day, day, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(randomId(8), user.id, clip.n, score,
          JSON.stringify(phraseScores(score, lines, rng(BASE + 7127 * clip.n + seat.i))), tier, clip.day, at).changes;
      }
      if (made) done.push({ n: clip.n, day: clip.day, added: made });
      added += made;
    }
    if (added && !dry) log(`seeded players: +${added} takes on ${done.length} clips`);
    return { added, accounts: accounts.length, today: todayN, days: done };
  }

  /** Takes every invented player out: their takes go, then the accounts, and the boards are real again. */
  function remove() {
    const out = tx(() => {
      const ids = q('SELECT id FROM users WHERE seed = 1').all().map((r) => r.id);
      let results = 0;
      for (const id of ids) {
        results += q('DELETE FROM results WHERE user_id = ?').run(id).changes;
        q('DELETE FROM users WHERE id = ?').run(id);
      }
      return { accounts: ids.length, takes: results };
    });
    if (out.accounts) log(`seeded players removed: ${out.accounts} accounts, ${out.takes} takes`);
    return out;
  }

  /** Real against invented, per clip, for the admin. */
  function status() {
    const accounts = q('SELECT COUNT(*) c FROM users WHERE seed = 1').get().c;
    const takes = q('SELECT COUNT(*) c FROM results r JOIN users u ON u.id = r.user_id WHERE u.seed = 1').get().c;
    const clips = q(`SELECT r.clip_n n, r.day day, SUM(u.seed) seeded, SUM(1 - u.seed) real
                     FROM results r JOIN users u ON u.id = r.user_id GROUP BY r.clip_n ORDER BY r.clip_n DESC LIMIT 14`).all();
    return { accounts, takes, clips: clips.map((c) => ({ n: c.n, day: c.day, seeded: c.seeded, real: c.real })) };
  }

  return { run, remove, status };
}
