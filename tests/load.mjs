#!/usr/bin/env node
// Load check against a staging instance (never production: it creates hundreds of anonymous users).
//   node tests/load.mjs --base https://staging.example --results 300 --reads 300 --seconds 60 \
//        [--pro 10 --pro-token <device token of a Pro user> --audio take.wav --phrase 0]
// Over --seconds it saves --results results (one new visitor each) and reads the aggregated stats
// --reads times; a third of the way in it sends --pro takes to the Pro scorer at the same instant.
import fs from 'node:fs';
import crypto from 'node:crypto';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const base = String(arg('base', 'http://localhost:8821')).replace(/\/$/, '');
const nResults = Number(arg('results', 300)), nReads = Number(arg('reads', 300)), seconds = Number(arg('seconds', 60));
const nPro = Number(arg('pro', 0)), proToken = arg('pro-token', ''), audio = arg('audio', ''), phrase = Number(arg('phrase', 0));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0);
const line = (name, rows) => {
  const ms = rows.map((r) => r.ms), by = {};
  for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;
  console.log(`${name.padEnd(14)} ${String(rows.length).padStart(4)} requests · ${Object.entries(by).map(([k, v]) => `${k}: ${v}`).join(', ')} · ms p50 ${pct(ms, 50)} p95 ${pct(ms, 95)} max ${Math.max(0, ...ms)}`);
};
async function timed(url, opts) {
  const t = performance.now();
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(30000) });
    const body = await r.json().catch(() => null);
    return { status: r.status, ms: Math.round(performance.now() - t), body };
  } catch (e) {
    return { status: 'ERR ' + (e.cause && e.cause.code ? e.cause.code : e.name), ms: Math.round(performance.now() - t), body: null };
  }
}

const health = await (await fetch(base + '/api/health')).json();
const { clip } = await (await fetch(`${base}/api/clip/${health.today}`)).json();
const count = clip.phrases.filter((p) => !p.skip).length;
console.log(`${base} · clip #${clip.n}, ${count} lines · ${nResults} results + ${nReads} stats reads in ${seconds} s${nPro ? ` · ${nPro} Pro takes at once` : ''}`);

const results = [], reads = [], pro = [], jobs = [];
const t0 = Date.now();
const at = (i, n) => t0 + (i / n) * seconds * 1000;
for (let i = 0; i < nResults; i++) {
  jobs.push((async () => {
    await sleep(Math.max(0, at(i, nResults) - Date.now()));
    const phrases = Array.from({ length: count }, () => 40 + Math.floor(Math.random() * 61));
    const score = Math.round(phrases.reduce((a, b) => a + b, 0) / count);
    results.push(await timed(base + '/api/results', {
      method: 'POST', headers: { Authorization: 'Bearer ' + crypto.randomBytes(24).toString('hex'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ n: clip.n, score, phrases, tier: 'web' }),
    }));
  })());
}
for (let i = 0; i < nReads; i++) {
  jobs.push((async () => {
    await sleep(Math.max(0, at(i + 0.5, nReads) - Date.now()));
    reads.push(await timed(base + (i % 3 === 2 ? '/api/rank/week' : `/api/stats/${clip.n}`)));
  })());
}
if (nPro) {
  const buf = fs.readFileSync(audio);
  const pcm = buf.subarray(buf.indexOf('data') + 8);
  jobs.push((async () => {
    await sleep((seconds * 1000) / 3);
    console.log(`  +${((Date.now() - t0) / 1000).toFixed(1)} s: ${nPro} Pro takes of ${(pcm.length / 32000).toFixed(1)} s sent at once`);
    await Promise.all(Array.from({ length: nPro }, async () => {
      pro.push(await timed(`${base}/api/pro/score?n=${clip.n}&p=${phrase}`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + proToken, 'Content-Type': 'application/octet-stream' }, body: pcm,
      }));
    }));
  })());
}
await Promise.all(jobs);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
line('save result', results);
line('read stats', reads);
if (nPro) {
  line('pro score', pro);
  const okRows = pro.filter((r) => r.status === 200);
  console.log(`pro: ${okRows.length} scored (model ms ${okRows.map((r) => r.body.ms).join(', ')}; waited in queue ms ${okRows.map((r) => r.body.wait).join(', ')}), ${pro.filter((r) => r.status === 503).length} turned away with "busy" in ${pro.filter((r) => r.status === 503).map((r) => r.ms).join(', ')} ms`);
}
const saved = results.filter((r) => r.status === 200 && r.body && r.body.saved).length;
const stats = await (await fetch(`${base}/api/stats/${clip.n}`)).json();
console.log(`saved ${saved}/${nResults} · the clip now counts ${stats.count} results`);
process.exit(saved === nResults && reads.every((r) => r.status === 200) ? 0 : 1);
