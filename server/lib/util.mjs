import crypto from 'node:crypto';

export const TZ = process.env.DC_TZ || 'Europe/Madrid';

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hmsFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

/** Calendar day (YYYY-MM-DD) of a timestamp in the product's timezone. */
export function dayOf(ms = Date.now()) {
  return dayFmt.format(new Date(ms));
}

/** Epoch ms of the next day change in the product's timezone. */
export function nextDayAt(ms = Date.now()) {
  const [h, m, s] = hmsFmt.format(new Date(ms)).split(':').map(Number);
  let t = ms + (86400 - (h % 24) * 3600 - m * 60 - s) * 1000;
  t -= t % 1000;
  // DST days are 23 or 25 hours long: walk to the real boundary
  const today = dayOf(ms);
  while (dayOf(t) === today) t += 3600e3;
  while (dayOf(t - 3600e3) !== today) t -= 3600e3;
  return t;
}

export function addDays(day, n) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week that contains `day`. */
export function weekStart(day) {
  const d = new Date(day + 'T12:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(day, -dow);
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
export function randomId(len = 8) {
  const b = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHA[b[i] % ALPHA.length];
  return out;
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const ADJ = ['Brave', 'Calm', 'Clever', 'Bold', 'Bright', 'Swift', 'Lucky', 'Mellow', 'Witty', 'Sunny', 'Quiet', 'Eager',
  'Jolly', 'Keen', 'Noble', 'Proud', 'Quick', 'Sharp', 'Steady', 'Zesty', 'Cosmic', 'Golden', 'Silver', 'Daring'];
const ANIMAL = ['Otter', 'Falcon', 'Panda', 'Fox', 'Koala', 'Lynx', 'Owl', 'Heron', 'Wolf', 'Tiger', 'Dolphin', 'Raven',
  'Badger', 'Gecko', 'Moose', 'Puffin', 'Robin', 'Seal', 'Swan', 'Yak', 'Bison', 'Crane', 'Finch', 'Hare'];
/** Alias from three bytes: the same bytes give the same alias, so invented players keep theirs. */
export function aliasFrom(b) {
  return `${ADJ[b[0] % ADJ.length]} ${ANIMAL[b[1] % ANIMAL.length]} ${10 + (b[2] % 90)}`;
}

export function randomAlias() {
  return aliasFrom(crypto.randomBytes(3));
}

/** First name only, trimmed to something safe to show in a public ranking. */
export function firstName(name) {
  const n = String(name || '').trim().split(/\s+/)[0] || '';
  return n.replace(/[<>&"']/g, '').slice(0, 18);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Fixed-window counter: allow(key, limit, windowMs) -> boolean. */
export class RateLimiter {
  constructor() {
    this.hits = new Map();
    setInterval(() => this.sweep(), 60e3).unref();
  }
  allow(key, limit, windowMs) {
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || now >= e.reset) {
      e = { n: 0, reset: now + windowMs };
      this.hits.set(key, e);
    }
    e.n++;
    return e.n <= limit;
  }
  sweep() {
    const now = Date.now();
    for (const [k, e] of this.hits) if (now >= e.reset) this.hits.delete(k);
  }
}
