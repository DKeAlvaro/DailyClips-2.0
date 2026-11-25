import fs from 'node:fs';
import path from 'node:path';
import { dayOf } from './util.mjs';

/**
 * Clips are prepared ahead of time as JSON files (clips/queue/<slug>.json, order in clips/queue.json)
 * and published one per day into the `clips` table with a public number.
 */
export function createClips({ q, tx }, queueDir, log = console.log) {
  const cache = new Map(); // n -> public clip object
  let todayCache = null; // { day, n }

  function readQueue() {
    const orderFile = path.join(path.dirname(queueDir), 'queue.json');
    let order = [];
    try {
      order = JSON.parse(fs.readFileSync(orderFile, 'utf8'));
    } catch {
      order = fs.readdirSync(queueDir).filter((f) => f.endsWith('.json')).sort().map((f) => f.slice(0, -5));
    }
    return order.filter((slug) => fs.existsSync(path.join(queueDir, slug + '.json')));
  }

  function loadSlug(slug) {
    return JSON.parse(fs.readFileSync(path.join(queueDir, slug + '.json'), 'utf8'));
  }

  /** Slugs in publishing order: never-published first (queue order), then the ones published longest ago. */
  function candidates() {
    const order = readQueue();
    const last = new Map(q('SELECT slug, MAX(published_at) t FROM clips GROUP BY slug').all().map((r) => [r.slug, r.t]));
    const fresh = order.filter((s) => !last.has(s));
    const used = order.filter((s) => last.has(s)).sort((a, b) => last.get(a) - last.get(b));
    return { fresh, used };
  }

  function publish(slug, day) {
    const clip = loadSlug(slug);
    return tx(() => {
      const exists = q('SELECT n FROM clips WHERE day = ?').get(day);
      if (exists) return exists.n;
      const n = (q('SELECT MAX(n) m FROM clips').get().m || 0) + 1;
      q('INSERT INTO clips (n, day, slug, json, published_at) VALUES (?, ?, ?, ?, ?)').run(n, day, slug, JSON.stringify(clip), Date.now());
      log(`published clip #${n} (${slug}) for ${day}`);
      return n;
    });
  }

  /** Makes sure today's clip exists. `check(clip)` may veto a candidate (async, e.g. the embed check). */
  async function ensureToday(check) {
    const day = dayOf();
    if (todayCache && todayCache.day === day) return todayCache.n;
    let row = q('SELECT n FROM clips WHERE day = ?').get(day);
    if (!row) {
      const { fresh, used } = candidates();
      const list = [...fresh, ...used];
      if (!list.length) throw new Error('clip queue is empty');
      let pick = list[0];
      if (check) {
        for (const slug of list.slice(0, 6)) {
          let ok = true;
          try {
            ok = await check(loadSlug(slug));
          } catch {
            ok = true; // a failing check never blocks the daily clip
          }
          if (ok) {
            pick = slug;
            break;
          }
          log(`skipping ${slug}: embed check failed`);
        }
      }
      if (!fresh.length) log('WARNING: clip queue exhausted, recycling old clips');
      row = { n: publish(pick, day) };
    }
    todayCache = { day, n: row.n };
    return row.n;
  }

  /** Sync variant used on the request path: no network checks. */
  function ensureTodaySync() {
    const day = dayOf();
    if (todayCache && todayCache.day === day) return todayCache.n;
    let row = q('SELECT n FROM clips WHERE day = ?').get(day);
    if (!row) {
      const { fresh, used } = candidates();
      const list = [...fresh, ...used];
      if (!list.length) return 0;
      row = { n: publish(list[0], day) };
    }
    todayCache = { day, n: row.n };
    return row.n;
  }

  function get(n) {
    n = Number(n);
    if (!Number.isInteger(n) || n < 1) return null;
    if (cache.has(n)) return cache.get(n);
    const row = q('SELECT n, day, slug, json FROM clips WHERE n = ?').get(n);
    if (!row) return null;
    const clip = { n: row.n, day: row.day, ...JSON.parse(row.json) };
    cache.set(n, clip);
    return clip;
  }

  function list() {
    return q('SELECT n, day, json FROM clips ORDER BY n DESC').all().map((r) => {
      const c = JSON.parse(r.json);
      return { n: r.n, day: r.day, title: c.title, yt: c.yt, ar: c.ar, src: c.src, count: c.phrases.length };
    });
  }

  /** What is left to publish and tomorrow's pick (for the teaser). */
  function upcoming() {
    const { fresh, used } = candidates();
    const next = [...fresh, ...used][0];
    return { left: fresh.length, next: next ? loadSlug(next) : null };
  }

  function replace(n, slug) {
    const clip = loadSlug(slug);
    q('UPDATE clips SET slug = ?, json = ? WHERE n = ?').run(slug, JSON.stringify(clip), n);
    cache.delete(n);
  }

  return { ensureToday, ensureTodaySync, get, list, upcoming, replace, readQueue, loadSlug, flush: () => cache.clear() };
}

/** true when YouTube still serves the video in embeds. Unknown answers count as fine. */
export async function embedOk(clip) {
  const url = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + clip.yt);
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  return ![400, 401, 403, 404].includes(r.status);
}
