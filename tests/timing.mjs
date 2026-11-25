#!/usr/bin/env node
// What a first visit downloads, and how long a take feels at the web and Pro levels, in a phone-sized
// real Chrome (optionally with the CPU slowed down N times to stand in for a phone).
//   node tests/timing.mjs --base https://llmers.es                         # first visit only (read-only)
//   node tests/timing.mjs --base <staging> --secret <DC_TEST_AUTH> --pro-sub load-pro [--throttle 4]
// --pro-sub: a test account of that instance that already has Pro (the takes of the Pro level use it).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch, speak } from './lib/browser.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? def : process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true;
};
const base = String(arg('base', 'https://llmers.es')).replace(/\/$/, '');
const secret = arg('secret', '');
const proSub = arg('pro-sub', '');
const throttle = Number(arg('throttle', 0));
const kb = (n) => (n / 1024).toFixed(0) + ' kB';

// ---- 1. first visit: everything the browser fetches until the clip is ready to play
{
  const { context, page } = await launch({ headless: true });
  // every request of every frame (the YouTube player lives in its own frame), bytes over the wire
  const urls = new Map(), sizes = new Map();
  let seq = 0;
  context.on('requestfinished', async (req) => {
    const id = ++seq;
    urls.set(id, req.url());
    const z = await req.sizes().catch(() => null);
    if (z) sizes.set(id, z.responseBodySize + z.responseHeadersSize);
  });
  const t0 = Date.now();
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app.ready', { timeout: 20000 });
  const ready = Date.now() - t0;
  await page.waitForTimeout(5000);
  const groups = { own: 0, youtube: 0, google: 0, other: 0 };
  const own = [];
  let heavy = 0;
  for (const [id, url] of urls) {
    const size = sizes.get(id) || 0;
    if (/^(data|blob):/.test(url)) continue;
    const host = new URL(url).host;
    if (/huggingface|onnxruntime|jsdelivr/.test(url)) heavy += size;
    if (host === new URL(base).host) {
      groups.own += size;
      own.push(`${new URL(url).pathname.split('/').pop() || '/'} ${kb(size)}`);
    } else if (/youtube|ytimg|googlevideo|ggpht|doubleclick/.test(host)) groups.youtube += size;
    else if (/google|gstatic/.test(host)) groups.google += size;
    else groups.other += size;
  }
  console.log(`first visit to ${base}: ready to play in ${(ready / 1000).toFixed(1)} s`);
  console.log(`  from the site itself: ${kb(groups.own)} over the wire  (${own.join(', ')})`);
  console.log(`  YouTube player (their CDN): ${kb(groups.youtube)} · Google sign-in script: ${kb(groups.google)} · anything else: ${kb(groups.other)}`);
  console.log(`  phoneme model or its runtime fetched without asking: ${heavy ? kb(heavy) + '  <-- WRONG' : 'nothing'}`);
  await context.close();
}

// ---- 2. a take at the web level and at the Pro level, same line, same audio
if (secret) {
  const health = await (await fetch(base + '/api/health')).json();
  const { clip } = await (await fetch(`${base}/api/clip/${health.today}`)).json();
  const unit = clip.phrases.find((p) => !p.skip && p.ph);
  const dir = path.resolve('work/pro-audio');
  fs.mkdirSync(dir, { recursive: true });
  const pad = 0.7;
  const job = { text: unit.text, voice: 'en-US-GuyNeural', out: path.join(dir, 'mic.wav'), rate: 48000, pad };
  fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify([job]));
  spawnSync('python', ['tools/tts.py', path.join(dir, 'jobs.json')], { windowsHide: true });
  const wav = fs.readFileSync(job.out);
  const audio = (wav.length - 44) / (48000 * 2);
  console.log(`\na take of "${unit.text}" (${(audio - 2 * pad).toFixed(1)} s of speech)${throttle ? `, CPU slowed down x${throttle}` : ''}:`);
  for (const tier of proSub ? ['web', 'pro'] : ['web']) {
    const { context, page } = await launch({ headless: true, throttle });
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.app.ready', { timeout: 30000 });
    if (tier === 'pro') {
      await page.evaluate(([s, id]) => window.dcTestLogin(s, id, 'Carga'), [secret, proSub]);
      await page.evaluate(() => { const S = JSON.parse(localStorage.getItem('dailyclips.v2')); S.tier = 'pro'; localStorage.setItem('dailyclips.v2', JSON.stringify(S)); });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.app.ready', { timeout: 30000 });
    }
    const serverMs = [];
    page.on('response', async (r) => {
      if (r.url().includes('/api/pro/score') && r.status() === 200) serverMs.push((await r.json()).ms);
    });
    const box = await page.evaluate(() => {
      const b = document.querySelector('.yt iframe').getBoundingClientRect();
      return { x: b.x + b.width / 2, y: Math.min(b.y + b.height / 2, innerHeight * 0.46) };
    });
    await page.touchscreen.tap(box.x, box.y);
    const times = [];
    for (let i = 0; i < 3; i++) {
      await page.waitForSelector('.deck.prompt', { timeout: 60000 });
      speak(job.out);
      const t = Date.now();
      await page.tap('#mic');
      await page.waitForSelector('.deck.feedback', { timeout: 60000 });
      times.push(Date.now() - t);
      if (i < 2) await page.tap('.deck.feedback .btns .btn:not(#next)'); // "again": the line is replayed, then it is our turn
    }
    const best = Math.min(...times);
    // the speech ends `pad` seconds before the audio does; what is left after that is waiting for the score
    console.log(`  ${tier.padEnd(4)} tap on the mic -> coloured words: ${times.map((x) => (x / 1000).toFixed(1)).join(', ')} s · best ${(best / 1000).toFixed(1)} s = ${((best - (audio - pad) * 1000) / 1000).toFixed(1)} s after the last word${serverMs.length ? ` (the server took ${serverMs.join(', ')} ms)` : ''}`);
    await context.close();
  }
}
