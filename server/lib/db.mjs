import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  pub TEXT NOT NULL UNIQUE,            -- public handle used in rankings and share links
  created_at INTEGER NOT NULL,
  alias TEXT NOT NULL,                 -- generated nickname, shown unless the user shows their first name
  google_sub TEXT UNIQUE,
  email TEXT,
  name TEXT,
  show_name INTEGER NOT NULL DEFAULT 1,
  is_test INTEGER NOT NULL DEFAULT 0,
  stripe_customer TEXT,
  stripe_sub TEXT,
  pro_status TEXT,                     -- stripe subscription status (active, past_due, canceled...)
  pro_until INTEGER,                   -- current period end (ms)
  pro_cancel INTEGER NOT NULL DEFAULT 0 -- cancel_at_period_end
);
CREATE TABLE IF NOT EXISTS devices (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS devices_user ON devices(user_id);
CREATE TABLE IF NOT EXISTS clips (
  n INTEGER PRIMARY KEY,               -- public clip number (#1, #2...)
  day TEXT NOT NULL UNIQUE,            -- release day, product timezone
  slug TEXT NOT NULL,
  json TEXT NOT NULL,
  published_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY,
  pub TEXT NOT NULL UNIQUE,            -- share id
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clip_n INTEGER NOT NULL,
  score INTEGER NOT NULL,
  phrases TEXT NOT NULL,               -- JSON array of per-phrase scores
  tier TEXT NOT NULL,                  -- web | dev | pro
  on_day INTEGER NOT NULL,             -- 1 when done on the clip's release day (counts for the streak)
  day TEXT NOT NULL,                   -- day it was done, product timezone
  sounds TEXT,                         -- JSON {phone: [sum, count]} for phoneme tiers
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, clip_n)
);
CREATE INDEX IF NOT EXISTS results_clip ON results(clip_n, score);
CREATE INDEX IF NOT EXISTS results_day ON results(day);
CREATE TABLE IF NOT EXISTS pro_usage (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS word_checks (  -- web-level takes that missed at most one word of a line
  clip_n INTEGER NOT NULL,
  line INTEGER NOT NULL,               -- index among the lines that are scored
  word INTEGER NOT NULL,               -- word missed, -1 when the whole line was understood
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (clip_n, line, word)
);
CREATE TABLE IF NOT EXISTS reports (
  clip_n INTEGER NOT NULL,
  code TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (clip_n, code)
);
`;

export function openDb(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'dailyclips.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 4000;');
  db.exec(SCHEMA);
  const cache = new Map();
  /** Prepared statements are cached by SQL text. */
  const q = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  return { db, q, tx };
}
