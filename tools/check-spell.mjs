// Runs the letter aligner (web/src/spell.js) over every word of every queued clip and prints the odd ones.
// node tools/check-spell.mjs [--all]
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spellOut, isKnown } from '../web/src/spell.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'clips', 'queue');
const all = process.argv.includes('--all');

// unique (word, phones) pairs
const pairs = new Map();
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  for (const ph of JSON.parse(readFileSync(join(dir, f), 'utf8')).phrases || []) {
    if (!ph.ph) continue;
    ph.text.split(/\s+/).filter(Boolean).forEach((w, i) => ph.ph[i] && pairs.set(w + '\t' + ph.ph[i].join(' '), [w, ph.ph[i]]));
  }
}

let nulls = 0, bad = 0, shown = 0;
const lines = [];
for (const [word, phones] of pairs.values()) {
  const ch = spellOut(word, phones);
  let flag = '';
  if (!ch) {
    nulls++;
    flag = 'null';
  } else {
    const used = ch.flatMap((c) => c.p).sort((a, b) => a - b);
    if (ch.map((c) => c.t).join('') !== word) bad++, (flag = 'JOIN MISMATCH');
    else if (used.join() !== phones.map((_, i) => i).join()) bad++, (flag = 'PHONE COVERAGE');
    else {
      for (const c of ch) {
        const letters = c.t.replace(/[^a-z]/gi, '');
        const ps = c.p.map((i) => phones[i]);
        if (c.p.length === 0 && /[a-z]/i.test(c.t)) flag ||= 'silent-alone';
        else if (c.p.length > 1) flag ||= 'multi';
        else if (letters.length >= 3 && !isKnown(c.t, ps)) flag ||= 'long';
      }
    }
  }
  if (!all && !flag) continue;
  shown++;
  const body = ch ? ch.map((c) => c.t).join('|') : '-';
  lines.push(`${word}  ->  ${body}  [${phones.join(' ')}]${flag && all ? '  ' + flag : ''}`);
}
lines.sort();
console.log(lines.join('\n'));
console.log(`\n${pairs.size} pairs, ${nulls} null, ${bad} invariant violations, ${shown} shown${all ? '' : ' (suspicious only)'}`);
if (bad) process.exit(1);
