#!/usr/bin/env node
// The invented players without a browser: they fill a board, their takes add up to their score, no
// take is ever written twice or in the future, the admin report tells them from real players, and
// remove() leaves the boards as they were.
//   node tests/seed.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openDb } from '../server/lib/db.mjs';
import { createSeed } from '../server/lib/seed.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dailyclips-seed-'));
const { q, tx } = openDb(dir);
const queue = new URL('../clips/queue/', import.meta.url);
const file = fs.readdirSync(queue).filter((f) => f.endsWith('.json')).sort()[0];
const clip = JSON.parse(fs.readFileSync(new URL(file, queue), 'utf8'));
const lines = clip.phrases.filter((p) => !p.skip).length;
const dayOf = (back) => new Date(Date.now() - back * 86400e3).toISOString().slice(0, 10);

const CLIPS = 5;
for (let n = 1; n <= CLIPS; n++) {
  const day = dayOf(CLIPS - n);
  q('INSERT INTO clips (n, day, slug, json, published_at) VALUES (?, ?, ?, ?, ?)')
    .run(n, day, 'test' + n, JSON.stringify(clip), Date.parse(day + 'T00:00:10Z'));
}

// one real player, to check the split the admin sees
const real = q("INSERT INTO users (pub, created_at, alias) VALUES ('realplayer', ?, 'Real Person 1')").run(Date.now());
q(`INSERT INTO results (pub, user_id, clip_n, score, phrases, tier, on_day, day, created_at)
   VALUES ('realresult', ?, 1, 70, ?, 'web', 1, ?, ?)`).run(real.lastInsertRowid, JSON.stringify(new Array(lines).fill(70)), dayOf(CLIPS - 1), Date.now());

const seed = createSeed({ q, tx });
const count = (n) => q('SELECT COUNT(*) c FROM results WHERE clip_n = ? AND user_id IN (SELECT id FROM users WHERE seed = 1)').get(n).c;

const dry = seed.run({ players: 40, dry: true });
assert.ok(dry.added > 0, 'a dry run counts what it would do');
assert.equal(count(1), 0, 'a dry run writes nothing');

const first = seed.run({ players: 40 });
assert.ok(first.added > 0, 'takes were added');
assert.equal(first.accounts, 40, 'the invented accounts are there');
for (let n = 1; n <= CLIPS; n++) assert.ok(count(n) > 0, `clip ${n} has invented players`);

const rows = q(`SELECT r.score, r.phrases, r.created_at, r.clip_n, r.tier FROM results r JOIN users u ON u.id = r.user_id
                WHERE u.seed = 1`).all();
assert.equal(rows.length, first.added);
for (const r of rows) {
  const p = JSON.parse(r.phrases);
  assert.equal(p.length, lines, 'one score per line');
  assert.ok(p.every((v) => Number.isInteger(v) && v >= 0 && v <= 100), 'line scores are on the same scale');
  assert.ok(Math.abs(Math.round(p.reduce((a, v) => a + v, 0) / lines) - r.score) <= 1, 'the lines add up to the score');
  assert.ok(r.created_at <= Date.now(), 'nobody plays in the future');
  assert.ok(['web', 'dev', 'pro'].includes(r.tier));
}

// the same run again changes nothing: one take per player and clip
assert.equal(seed.run({ players: 40 }).added, 0, 'a second run adds nothing');

// the daily top-up only looks at today's clip
seed.remove();
const live = seed.run({ players: 40, live: true });
assert.ok(live.days.every((c) => c.n === CLIPS), 'live only touches today');
assert.equal(live.added, count(CLIPS));

// the admin report: real against invented, per clip
const st = seed.status();
assert.equal(st.accounts, 40);
assert.equal(st.takes, live.added);
const first1 = st.clips.find((c) => c.n === 1);
assert.equal(first1.seeded, count(1));
assert.equal(first1.real, 1, 'the real player is counted apart');

// and out again: every take of theirs goes, the real player stays
const gone = seed.remove();
assert.equal(gone.accounts, 40);
assert.equal(gone.takes, live.added);
assert.equal(q('SELECT COUNT(*) c FROM users WHERE seed = 1').get().c, 0);
assert.equal(q('SELECT COUNT(*) c FROM results').get().c, 1, 'only the real result is left');

fs.rmSync(dir, { recursive: true, force: true });
console.log('seed ok:', first.added, 'takes on', CLIPS, 'clips,', st.clips.map((c) => `${c.n}:${c.seeded}`).join(' '));
