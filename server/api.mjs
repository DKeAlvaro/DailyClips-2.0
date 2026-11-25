#!/usr/bin/env node
// DailyClips API: daily clip, results, streaks, stats, rankings, Google login.
// Zero dependencies: node:http + node:sqlite. One process, one SQLite file.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from './lib/db.mjs';
import { createClips, embedOk } from './lib/clips.mjs';
import { verifyGoogleIdToken } from './lib/google.mjs';
import { createBilling } from './lib/billing.mjs';
import { createPro } from './lib/pro.mjs';
import {
  dayOf, nextDayAt, addDays, weekStart, sha256, randomId, randomAlias, firstName, escapeHtml, safeEqual, RateLimiter,
} from './lib/util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env (never committed) fills whatever the environment does not set
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env */ }

const env = process.env;
const cfg = {
  port: Number(env.DC_PORT || 8821),
  host: env.DC_HOST || '127.0.0.1',
  dataDir: env.DC_DATA || path.join(ROOT, 'data'),
  dist: env.DC_DIST || path.join(ROOT, 'dist'),
  queueDir: path.join(ROOT, 'clips', 'queue'),
  baseUrl: (env.DC_BASE_URL || 'http://localhost:8821').replace(/\/$/, ''),
  googleClientId: env.GOOGLE_CLIENT_ID || '',
  testSecret: env.DC_TEST_AUTH || '', // only set on staging/local: enables /api/auth/test
  adminSecret: env.DC_ADMIN || '',
  rateScale: Number(env.DC_RATE_SCALE || 1),
};

const log = (...a) => console.log(new Date().toISOString(), ...a);
const store = openDb(cfg.dataDir);
const { q, tx } = store;
const clips = createClips(store, cfg.queueDir, log);
const limiter = new RateLimiter();
const allow = (key, limit, windowMs) => limiter.allow(key, limit * cfg.rateScale, windowMs);

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const bad = (status, code) => new HttpError(status, code);

// ---------------------------------------------------------------- users

function userByToken(token) {
  if (!/^[a-f0-9]{32,64}$/.test(token || '')) return null;
  return q('SELECT u.* FROM devices d JOIN users u ON u.id = d.user_id WHERE d.token_hash = ?').get(sha256(token)) || null;
}

function createUser(extra = {}) {
  const now = Date.now();
  const r = q('INSERT INTO users (pub, created_at, alias, google_sub, email, name, is_test) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomId(10), now, randomAlias(), extra.google_sub || null, extra.email || null, extra.name || null, extra.is_test ? 1 : 0);
  return q('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
}

function attachDevice(token, userId) {
  const now = Date.now();
  q(`INSERT INTO devices (token_hash, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)
     ON CONFLICT(token_hash) DO UPDATE SET user_id = excluded.user_id, last_seen = excluded.last_seen`).run(sha256(token), userId, now, now);
}

/** The user behind the request's device token; anonymous users are created on first write. */
function auth(req, { create = false } = {}) {
  const token = (/^Bearer ([a-f0-9]+)$/.exec(req.headers.authorization || '') || [])[1];
  if (!token || !/^[a-f0-9]{32,64}$/.test(token)) {
    if (create) throw bad(401, 'no_token');
    return null;
  }
  let user = userByToken(token);
  if (!user && create) {
    if (!allow('newuser:' + req.ip, 200, 3600e3)) throw bad(429, 'slow_down');
    user = tx(() => {
      const u = createUser();
      attachDevice(token, u.id);
      return u;
    });
  }
  if (user) req.token = token;
  return user;
}

const isPro = (u) => !!u && ['active', 'trialing'].includes(u.pro_status) && (u.pro_until || 0) > Date.now() - 86400e3;
const displayName = (u) => (u.show_name && u.name ? firstName(u.name) : '') || u.alias;

function streakOf(days, today) {
  const set = new Set(days);
  let d = set.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (set.has(d)) {
    current++;
    d = addDays(d, -1);
  }
  let best = 0, run = 0, prev = null;
  for (const x of [...set].sort()) {
    run = prev && addDays(prev, 1) === x ? run + 1 : 1;
    best = Math.max(best, run);
    prev = x;
  }
  return { current, best, today: set.has(today) };
}

function profile(user) {
  const rows = q(`SELECT r.pub, r.clip_n n, r.score, r.phrases, r.tier, r.on_day, r.day, r.sounds, r.created_at at
                  FROM results r WHERE r.user_id = ? ORDER BY r.clip_n DESC LIMIT 400`).all(user.id);
  const results = rows.map((r) => ({
    id: r.pub, n: r.n, score: r.score, phrases: JSON.parse(r.phrases), tier: r.tier, onDay: !!r.on_day, day: r.day, at: r.at,
    ...(r.sounds ? { sounds: JSON.parse(r.sounds) } : {}),
  }));
  return {
    user: {
      id: user.pub, alias: user.alias, name: user.name ? firstName(user.name) : null, email: user.email || null,
      google: !!user.google_sub, showName: !!user.show_name, shown: displayName(user),
      pro: { active: isPro(user), until: user.pro_until || null, cancel: !!user.pro_cancel, status: user.pro_status || null },
    },
    streak: streakOf(rows.filter((r) => r.on_day).map((r) => r.day), dayOf()),
    results,
  };
}

/** Moves everything from anonymous user `from` into account `to` (earliest result per clip wins). */
function mergeUsers(from, to) {
  if (from.id === to.id) return;
  for (const r of q('SELECT * FROM results WHERE user_id = ?').all(from.id)) {
    const mine = q('SELECT id, created_at FROM results WHERE user_id = ? AND clip_n = ?').get(to.id, r.clip_n);
    if (!mine) q('UPDATE results SET user_id = ? WHERE id = ?').run(to.id, r.id);
    else if (r.created_at < mine.created_at) {
      q('DELETE FROM results WHERE id = ?').run(mine.id);
      q('UPDATE results SET user_id = ? WHERE id = ?').run(to.id, r.id);
    }
  }
  q('UPDATE devices SET user_id = ? WHERE user_id = ?').run(to.id, from.id);
  q('DELETE FROM users WHERE id = ?').run(from.id);
}

/** Signs the request's device into the account identified by `sub`, keeping what the device had. */
function signIn(req, { sub, email, name, isTest = false }) {
  const token = (/^Bearer ([a-f0-9]{32,64})$/.exec(req.headers.authorization || '') || [])[1];
  if (!token) throw bad(401, 'no_token');
  return tx(() => {
    const device = userByToken(token);
    let account = q('SELECT * FROM users WHERE google_sub = ?').get(sub);
    if (account && device && device.id !== account.id) {
      if (device.google_sub) attachDevice(token, account.id); // device belonged to another account: just switch
      else mergeUsers(device, account);
    } else if (account && !device) {
      attachDevice(token, account.id);
    } else if (!account && device && !device.google_sub) {
      q('UPDATE users SET google_sub = ?, email = ?, name = ?, is_test = ? WHERE id = ?').run(sub, email || null, name || null, isTest ? 1 : 0, device.id);
      account = device;
    } else if (!account) {
      account = createUser({ google_sub: sub, email, name, is_test: isTest });
      attachDevice(token, account.id);
    }
    q('UPDATE users SET email = COALESCE(?, email), name = COALESCE(?, name) WHERE id = ?').run(email || null, name || null, account.id);
    statsCache.clear();
    return q('SELECT * FROM users WHERE id = ?').get(account.id);
  });
}

// ---------------------------------------------------------------- stats (aggregated + cached)

const statsCache = new Map(); // key -> { at, data }
const STATS_TTL = 10e3;

function cached(key, ttl, compute) {
  const hit = statsCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const data = compute();
  statsCache.set(key, { at: Date.now(), data });
  return data;
}

function clipStats(n) {
  return cached('clip:' + n, STATS_TTL, () => {
    const rows = q(`SELECT r.score, r.phrases, r.tier, r.created_at, u.pub, u.name, u.show_name, u.alias
                    FROM results r JOIN users u ON u.id = r.user_id WHERE r.clip_n = ?
                    ORDER BY r.score DESC, r.created_at ASC`).all(n);
    const scores = {};
    let sum = 0;
    let phr = null;
    for (const r of rows) {
      scores[r.score] = (scores[r.score] || 0) + 1;
      sum += r.score;
      const p = JSON.parse(r.phrases);
      if (!phr) phr = new Array(p.length).fill(0);
      if (p.length === phr.length) p.forEach((v, i) => { phr[i] += v; });
    }
    return {
      n, count: rows.length, avg: rows.length ? Math.round(sum / rows.length) : null, scores,
      phrases: phr ? phr.map((v) => Math.round(v / rows.length)) : [],
      top: rows.slice(0, 100).map((r) => ({ u: r.pub, name: displayName(r), score: r.score, tier: r.tier })),
    };
  });
}

function weekStats() {
  const from = weekStart(dayOf());
  return cached('week:' + from, STATS_TTL, () => {
    const rows = q(`SELECT u.pub, u.name, u.show_name, u.alias, SUM(r.score) total, COUNT(*) days, MIN(r.created_at) first
                    FROM results r JOIN users u ON u.id = r.user_id JOIN clips c ON c.n = r.clip_n
                    WHERE c.day >= ? AND c.day <= ? GROUP BY u.id ORDER BY total DESC, first ASC LIMIT 200`).all(from, addDays(from, 6));
    const people = q(`SELECT COUNT(DISTINCT r.user_id) c FROM results r JOIN clips c ON c.n = r.clip_n WHERE c.day >= ? AND c.day <= ?`).get(from, addDays(from, 6)).c;
    return { from, to: addDays(from, 6), count: people, top: rows.map((r) => ({ u: r.pub, name: displayName(r), score: r.total, days: r.days })) };
  });
}

// ---------------------------------------------------------------- pages

let tpl = { mtime: 0, html: '' };
function template() {
  const f = path.join(cfg.dist, 'index.html');
  const m = fs.statSync(f).mtimeMs;
  if (m !== tpl.mtime) tpl = { mtime: m, html: fs.readFileSync(f, 'utf8') };
  return tpl.html;
}

// Link previews. A plain link invites you to try the clip; a link with ?vs=<result> is a dare from that
// person, with their score in the title and a picture of that score: one pre-rendered image per score
// (tools/make-og.mjs), so nothing is drawn at request time. The folder is versioned because /assets/ is
// cached for a year: bump OG_V together with V in tools/make-og.mjs when the images are redrawn.
const OG_V = 1;
const OG = {
  es: {
    title: (c) => `¿Cuánto sacas imitando un clip de ${c.src || c.title}?`,
    desc: (c, k, sec) => `«${c.title}»: ${k} frases, ${sec} segundos. Repítelas en inglés y te da una nota de 0 a 100. Sin registro.`,
    vsTitle: (name, score) => `${name} ha sacado ${score}/100. ${score === 100 ? '¿Lo igualas?' : '¿Le ganas?'}`,
    vsDesc: (c, k, sec) => `Imita en inglés un clip de ${c.src || c.title}: ${k} frases, ${sec} segundos. Sin registro.`,
    alt: (score) => (score == null ? 'DailyClips: ¿cuánto sacas?' : `${score} contra ti. ${score === 100 ? '¿Lo igualas?' : '¿Le ganas?'}`),
  },
  en: {
    title: (c) => `How well can you imitate a clip from ${c.src || c.title}?`,
    desc: (c, k, sec) => `"${c.title}": ${k} lines, ${sec} seconds. Say them in English and get a score from 0 to 100. No sign-up.`,
    vsTitle: (name, score) => `${name} scored ${score}/100. ${score === 100 ? 'Can you match it?' : 'Can you beat that?'}`,
    vsDesc: (c, k, sec) => `Imitate a clip from ${c.src || c.title} in English: ${k} lines, ${sec} seconds. No sign-up.`,
    alt: (score) => (score == null ? 'DailyClips: what will you score?' : `${score} versus you. ${score === 100 ? 'Can you match it?' : 'Can you beat it?'}`),
  },
};

function publicResult(pub) {
  if (!/^[a-z0-9]{6,14}$/.test(pub || '')) return null;
  const r = q(`SELECT r.pub, r.clip_n n, r.score, r.phrases, r.tier, u.name, u.show_name, u.alias
               FROM results r JOIN users u ON u.id = r.user_id WHERE r.pub = ?`).get(pub);
  return r ? { id: r.pub, n: r.n, score: r.score, phrases: JSON.parse(r.phrases), tier: r.tier, name: displayName(r) } : null;
}

function renderPage(n, url) {
  const todayN = clips.ensureTodaySync();
  const clip = clips.get(n || todayN);
  if (!clip) return null;
  const lang = url.searchParams.get('l') === 'en' ? 'en' : 'es';
  const vs = publicResult(url.searchParams.get('vs'));
  const t = OG[lang];
  const dare = vs && vs.n === clip.n;
  const lines = clip.phrases.filter((p) => !p.skip).length;
  const secs = Math.max(1, Math.round(clip.phrases[clip.phrases.length - 1].t1 - clip.phrases[0].t0));
  const score = dare ? Math.max(0, Math.min(100, Math.round(vs.score))) : null;
  const ogTitle = dare ? t.vsTitle(vs.name, score) : t.title(clip);
  const desc = dare ? t.vsDesc(clip, lines, secs) : t.desc(clip, lines, secs);
  const canon = `${cfg.baseUrl}/c/${clip.n}`;
  const og = [
    `<title>${escapeHtml(n ? `${clip.title} · DailyClips` : 'DailyClips')}</title>`,
    `<meta name="description" content="${escapeHtml(desc)}">`,
    `<link rel="canonical" href="${n ? canon : cfg.baseUrl + '/'}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="DailyClips">`,
    `<meta property="og:title" content="${escapeHtml(ogTitle)}">`,
    `<meta property="og:description" content="${escapeHtml(desc)}">`,
    `<meta property="og:url" content="${canon}">`,
    `<meta property="og:image" content="${cfg.baseUrl}/assets/og${OG_V}/${dare ? score : 'default'}.jpg">`,
    `<meta property="og:image:type" content="image/jpeg">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${escapeHtml(t.alt(score))}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join('\n  ');
  const stats = clipStats(clip.n);
  const up = clip.n === todayN ? clips.upcoming() : null;
  const boot = {
    now: Date.now(), today: todayN, day: dayOf(), nextAt: nextDayAt(), clip, count: stats.count,
    vs: vs && vs.n === clip.n ? vs : null,
    teaser: up && up.next ? { yt: up.next.yt, ar: up.next.ar } : null,
    cfg: { gid: cfg.googleClientId, test: !!cfg.testSecret, pro: billing.publicConfig() },
  };
  const json = JSON.stringify(boot).replace(/</g, '\\u003c');
  return template().replace('<!--OG-->', og).replace('<!--BOOT-->', `<script id="boot" type="application/json">${json}</script>`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json', '.wasm': 'application/wasm', '.jpg': 'image/jpeg',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(cfg.dist, rel);
  if (!file.startsWith(cfg.dist + path.sep)) return false;
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return false;
  }
  if (st.isDirectory()) {
    res.writeHead(301, { Location: pathname + '/' });
    res.end();
    return true;
  }
  const headers = {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
  return true;
}

// ---------------------------------------------------------------- http plumbing

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(bad(413, 'too_large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, max = 32 * 1024) {
  const buf = await readBody(req, max);
  try {
    return JSON.parse(buf.toString('utf8') || '{}');
  } catch {
    throw bad(400, 'bad_json');
  }
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

const PAGE_HEADERS = {
  'Cache-Control': 'no-cache',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
};

const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// ---------------------------------------------------------------- services that need the pieces above

const billing = createBilling({ cfg, env, q, log, bad, isPro, allow, onChange: () => statsCache.clear() });
const pro = createPro({ env, q, log, bad, isPro, clips, allow });

// ---------------------------------------------------------------- routes

const routes = [];
const route = (method, pattern, fn) => routes.push({ method, pattern, fn });

route('GET', /^\/api\/health$/, () => ({ ok: true, day: dayOf(), today: clips.ensureTodaySync() }));

route('GET', /^\/api\/clip\/(\d+)$/, (req, m) => {
  const clip = clips.get(Number(m[1]));
  if (!clip) throw bad(404, 'no_clip');
  return { clip, count: clipStats(clip.n).count };
});

route('GET', /^\/api\/archive$/, () => ({ today: clips.ensureTodaySync(), clips: clips.list() }));

route('GET', /^\/api\/stats\/(\d+)$/, (req, m) => {
  if (!clips.get(Number(m[1]))) throw bad(404, 'no_clip');
  return clipStats(Number(m[1]));
});

route('GET', /^\/api\/rank\/week$/, () => weekStats());

route('GET', /^\/api\/r\/([a-z0-9]{6,14})$/, (req, m) => {
  const r = publicResult(m[1]);
  if (!r) throw bad(404, 'no_result');
  return r;
});

route('GET', /^\/api\/me$/, (req) => {
  const user = auth(req);
  return user ? profile(user) : { user: null, streak: { current: 0, best: 0, today: false }, results: [] };
});

route('POST', /^\/api\/results$/, async (req) => {
  const user = auth(req, { create: true });
  if (!allow('res:' + user.id, 30, 60e3)) throw bad(429, 'slow_down');
  const b = await readJson(req);
  const clip = clips.get(b.n);
  if (!clip) throw bad(404, 'no_clip');
  const count = clip.phrases.filter((p) => !p.skip).length;
  if (!Array.isArray(b.phrases) || b.phrases.length !== count || !b.phrases.every((v) => int(v, 0, 100))) throw bad(400, 'bad_phrases');
  const mean = Math.round(b.phrases.reduce((a, v) => a + v, 0) / count);
  if (!int(b.score, 0, 100) || Math.abs(b.score - mean) > 1) throw bad(400, 'bad_score');
  let tier = ['web', 'dev', 'pro'].includes(b.tier) ? b.tier : 'web';
  if (tier === 'pro' && !isPro(user)) tier = 'dev';
  let sounds = null;
  if (tier !== 'web' && b.sounds && typeof b.sounds === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(b.sounds).slice(0, 80)) {
      if (k.length <= 6 && Array.isArray(v) && v.length === 2 && int(Math.round(v[0]), 0, 100 * 200) && int(v[1], 1, 200)) clean[k] = [Math.round(v[0]), v[1]];
    }
    if (Object.keys(clean).length) sounds = JSON.stringify(clean);
  }
  const now = Date.now();
  const today = dayOf(now);
  const r = q(`INSERT OR IGNORE INTO results (pub, user_id, clip_n, score, phrases, tier, on_day, day, sounds, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomId(8), user.id, clip.n, b.score, JSON.stringify(b.phrases), tier, clip.day === today ? 1 : 0, today, sounds, now);
  if (r.changes) {
    statsCache.delete('clip:' + clip.n);
    statsCache.delete('week:' + weekStart(today));
  }
  return { saved: !!r.changes, ...profile(user), stats: clipStats(clip.n) };
});

route('POST', /^\/api\/auth\/google$/, async (req) => {
  if (!cfg.googleClientId) throw bad(503, 'login_off');
  if (!allow('auth:' + req.ip, 20, 60e3)) throw bad(429, 'slow_down');
  const b = await readJson(req);
  let claims;
  try {
    claims = await verifyGoogleIdToken(b.credential, cfg.googleClientId);
  } catch (e) {
    log('google login rejected:', e.message);
    throw bad(401, 'bad_credential');
  }
  return profile(signIn(req, { sub: claims.sub, email: claims.email, name: claims.given_name || claims.name }));
});

route('POST', /^\/api\/auth\/test$/, async (req) => {
  const b = await readJson(req);
  if (!cfg.testSecret || !safeEqual(b.secret || '', cfg.testSecret)) throw bad(404, 'not_found');
  const sub = 'test:' + String(b.sub || 'user').replace(/[^a-z0-9-]/gi, '').slice(0, 24);
  return profile(signIn(req, { sub, email: sub.slice(5) + '@test.invalid', name: String(b.name || 'Test').slice(0, 24), isTest: true }));
});

route('POST', /^\/api\/auth\/logout$/, (req) => {
  const user = auth(req);
  if (user) q('DELETE FROM devices WHERE token_hash = ?').run(sha256(req.token));
  return { ok: true };
});

route('POST', /^\/api\/me\/name$/, async (req) => {
  const user = auth(req);
  if (!user) throw bad(401, 'no_user');
  const b = await readJson(req);
  q('UPDATE users SET show_name = ? WHERE id = ?').run(b.showName ? 1 : 0, user.id);
  statsCache.clear();
  return profile(q('SELECT * FROM users WHERE id = ?').get(user.id));
});

route('DELETE', /^\/api\/me$/, async (req) => {
  const user = auth(req);
  if (!user) throw bad(401, 'no_user');
  await billing.cancelNow(user).catch((e) => log('cancel on delete failed:', e.message));
  q('DELETE FROM users WHERE id = ?').run(user.id);
  statsCache.clear();
  log('user deleted', user.pub);
  return { ok: true };
});

route('POST', /^\/api\/report$/, async (req) => {
  // the player could not show a clip (video removed, embedding turned off...)
  if (!allow('report:' + req.ip, 10, 3600e3)) return { ok: true };
  const b = await readJson(req);
  if (!clips.get(b.n)) throw bad(404, 'no_clip');
  const code = String(b.code || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 16) || 'unknown';
  q(`INSERT INTO reports (clip_n, code, n, last_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(clip_n, code) DO UPDATE SET n = n + 1, last_at = excluded.last_at`).run(b.n, code, Date.now());
  return { ok: true };
});

route('POST', /^\/internal\/publish$/, async (req) => {
  // called by the daily cron from localhost
  if (!cfg.adminSecret || !safeEqual(req.headers['x-admin'] || '', cfg.adminSecret)) throw bad(404, 'not_found');
  const n = await clips.ensureToday(embedOk);
  const up = clips.upcoming();
  return { today: n, day: dayOf(), left: up.left };
});

billing.routes(route, { auth, readJson, readBody, profile });
pro.routes(route, { auth, readBody });

// ---------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  req.ip = (local && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
  try {
    if (p.startsWith('/api/') || p.startsWith('/internal/')) {
      if (!allow('ip:' + req.ip, 600, 60e3)) throw bad(429, 'slow_down');
      for (const r of routes) {
        const m = r.method === req.method && r.pattern.exec(p);
        if (!m) continue;
        const out = await r.fn(req, m, url, res);
        if (out !== undefined && !res.writableEnded) send(res, 200, out);
        return;
      }
      throw bad(404, 'not_found');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw bad(405, 'method');
    const m = /^\/c\/(\d+)\/?$/.exec(p);
    if (p === '/' || m) {
      const html = renderPage(m ? Number(m[1]) : 0, url);
      if (!html) {
        res.writeHead(302, { Location: '/' });
        return res.end();
      }
      return send(res, 200, html, PAGE_HEADERS);
    }
    if (serveStatic(req, res, p)) return;
    res.writeHead(302, { Location: '/' });
    res.end();
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500 && e.code !== 'busy') log('ERROR', req.method, p, e.stack || e); // "busy" is the Pro queue saying no, as designed
    if (!res.headersSent) send(res, status, { error: e.code || 'server_error' });
    else res.end();
  } finally {
    const ms = Date.now() - started;
    if (ms > 500 && !p.startsWith("/api/pro/")) log("slow", req.method, p, ms + "ms");
  }
});

server.requestTimeout = 30e3;
server.headersTimeout = 10e3;
server.listen(cfg.port, cfg.host, () => {
  log(`dailyclips api on http://${cfg.host}:${cfg.port} (data: ${cfg.dataDir}, base: ${cfg.baseUrl})`);
  try {
    log('today is clip #' + clips.ensureTodaySync());
  } catch (e) {
    log('no clip for today:', e.message);
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
