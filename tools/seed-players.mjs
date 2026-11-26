#!/usr/bin/env node
// Invented players for the boards (server/lib/seed.mjs). A board that a handful of people have played
// reads as a dead product, so a few dozen made-up accounts play along; only his own accounts can tell
// them from real players (DC_ADMIN_EMAILS in the API). On the VPS use `deploy/seed.sh` instead of this
// script, so the API itself does the writing (the database belongs to another user).
//   node tools/seed-players.mjs                     # every clip, up to the people who would have played by now
//   node tools/seed-players.mjs --live              # only today's clip, up to this minute (cron: every half hour)
//   node tools/seed-players.mjs --players 80 --today 40 --days 30
//   node tools/seed-players.mjs --dry               # what it would add, without writing
//   node tools/seed-players.mjs --status            # real against invented, per clip
//   node tools/seed-players.mjs --remove            # take every invented player out again
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/lib/db.mjs';
import { createSeed } from '../server/lib/seed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const has = (n) => process.argv.includes('--' + n);
const num = (n, d) => (arg(n, null) == null ? d : Number(arg(n)));

const { q, tx } = openDb(arg('data', path.join(ROOT, 'data')));
const seed = createSeed({ q, tx });

if (has('remove')) console.log(JSON.stringify(seed.remove()));
else if (has('status')) console.log(JSON.stringify(seed.status(), null, 2));
else {
  const out = seed.run({
    live: has('live'), dry: has('dry'),
    players: num('players', 60), days: num('days', 90), today: num('today', null),
  });
  console.log(JSON.stringify({ ...out, ...seed.status() }, null, 2));
}
