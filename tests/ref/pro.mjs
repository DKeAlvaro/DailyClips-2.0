#!/usr/bin/env node
// Sanity check and timing of the Pro level: every reference audio goes through the running scoring
// service and is put on the common scale with the app's own code (web/src/phon.js).
//   node tests/ref/pro.mjs --url http://127.0.0.1:8830 --key <SCORER_KEY> [--dir work/ref]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scorePhrase } from '../../web/src/phon.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const url = String(arg('url', 'http://127.0.0.1:8830')).replace(/\/$/, '');
const key = arg('key', process.env.SCORER_KEY || '');
const dir = path.resolve(arg('dir', 'work/ref'));
const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const phones = JSON.parse(fs.readFileSync(path.join(dir, 'phones.json'), 'utf8'));
const texts = JSON.parse(fs.readFileSync(path.join(here, 'phrases.json'), 'utf8'));
const vocab = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'scorer', 'vocab.json'), 'utf8'));

async function ask(i, file) {
  const buf = fs.readFileSync(path.join(dir, file));
  const pcm = buf.subarray(buf.indexOf('data') + 8);
  const ids = phones[i].flat().map((p) => vocab[p]).join(',');
  const t = performance.now();
  const r = await fetch(`${url}/score?ph=${ids}`, { method: 'POST', body: pcm, headers: { 'X-Scorer-Key': key } });
  if (!r.ok) throw new Error('scorer answered ' + r.status);
  return { ...(await r.json()), total: Math.round(performance.now() - t), seconds: pcm.length / 32000 };
}

const out = [];
const n = texts.length;
for (let i = 0; i < n; i++) {
  const unit = { text: texts[i], ph: phones[i] };
  // native reference: the male native voice decides which phones count, as tools/prep/refs.py does per clip
  const ref = await ask(i, `${i}-native-m.wav`);
  let mask = ref.rows.map((r) => (r.gop != null && r.gop >= -4 ? '1' : '0')).join('');
  if ((mask.match(/1/g) || []).length < Math.max(3, mask.length / 3)) mask = '1'.repeat(mask.length);
  unit.m = { pro: mask };
  for (const item of index.filter((x) => x.phrase === i)) {
    const r = await ask(i, item.file);
    out.push({ ...item, score: scorePhrase(unit, r.rows, 'pro', r.extra).score, ms: r.ms, total: r.total, seconds: r.seconds });
  }
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
let ok = 0;
for (let i = 0; i < n; i++) {
  const c = (cond, voice) => out.filter((o) => o.phrase === i && o.cond === cond && (!voice || o.voice === voice)).map((o) => o.score);
  const nat = mean(c('native', 'native-f')), spa = mean(c('spanish')), oth = mean(c('other'));
  const good = nat > spa && spa > oth;
  ok += good;
  console.log(`phrase ${i}: native ${nat.toFixed(0).padStart(3)}  spanish ${spa.toFixed(0).padStart(3)}  other ${oth.toFixed(0).padStart(3)}  ${good ? 'ok' : 'ORDER BROKEN'}   "${texts[i]}"`);
}
const by = (cond, voice) => mean(out.filter((o) => o.cond === cond && (!voice || o.voice === voice)).map((o) => o.score));
console.log(`\nmeans: native ${by('native', 'native-f').toFixed(0)} (other native voice than the reference) · spanish ${by('spanish').toFixed(0)} · other ${by('other').toFixed(0)}   (web level on the same audio: 100 · 77 · 8)`);
console.log(`order native > spanish > other holds in ${ok}/${n} phrases`);
const ms = out.map((o) => o.ms), secs = out.map((o) => o.seconds);
console.log(`time per phrase in the scorer: mean ${Math.round(mean(ms))} ms, max ${Math.max(...ms)} ms, for audio of ${mean(secs).toFixed(1)} s on average (x${(mean(ms) / 1000 / mean(secs)).toFixed(2)} realtime)`);
