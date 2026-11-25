#!/usr/bin/env node
// End-to-end check in a phone-sized real Chrome with a fake microphone:
//   1. anonymous visitor completes today's clip by "speaking" every line (TTS audio through the fake mic)
//   2. a test session signs in, keeps what the anonymous visitor did, and sees stats and ranking
//   3. the share link lands a second visitor on the same clip with the challenge on screen
//
//   node tests/e2e.mjs --base http://localhost:8821 --secret <DC_TEST_AUTH> [--headed] [--shots dir]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch, speak } from './lib/browser.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? def : process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true;
};
const base = String(arg('base', 'http://localhost:8821')).replace(/\/$/, '');
const secret = arg('secret', process.env.DC_TEST_AUTH || '');
const shots = arg('shots', 'work/e2e-shots');
const headless = !arg('headed', false);
fs.mkdirSync(shots, { recursive: true });

let failed = 0;
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5) + 's';
const ok = (cond, what, extra = '') => {
  if (!cond) failed++;
  console.log(`${stamp()} ${cond ? 'PASS' : 'FAIL'}  ${what}${extra ? '  (' + extra + ')' : ''}`);
};

// ---- today's clip and the audio for each line
const health = await (await fetch(base + '/api/health')).json();
const { clip } = await (await fetch(`${base}/api/clip/${health.today}`)).json();
const units = clip.phrases.filter((p) => !p.skip);
console.log(`${stamp()} clip #${clip.n} "${clip.title}" · ${units.length} lines`);
const dir = path.resolve('work/e2e-audio');
const jobs = units.map((u, i) => ({ text: u.text, voice: 'en-US-GuyNeural', out: path.join(dir, `${clip.yt}-${i}.wav`), rate: 48000, pad: 0.7 }));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(jobs));
const tts = spawnSync('python', ['tools/tts.py', path.join(dir, 'jobs.json')], { encoding: 'utf8', windowsHide: true });
ok(jobs.every((j) => fs.existsSync(j.out)), 'reference audio synthesised', (tts.stdout || tts.stderr || '').trim().split('\n').pop());

// ---- 1. anonymous visitor
const a = await launch({ headless });
const errors = [];
a.page.on('pageerror', (e) => errors.push(e.message));
const nav0 = Date.now();
await a.page.goto(base + '/', { waitUntil: 'domcontentloaded' });
await a.page.waitForSelector('.app.ready', { timeout: 15000 });
const box = await a.page.evaluate(() => {
  const r = document.querySelector('.yt iframe').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: Math.min(r.y + r.height / 2, innerHeight * 0.46) };
});
await a.page.waitForTimeout(400);
await a.page.screenshot({ path: path.join(shots, '1-start.png') });
await a.page.touchscreen.tap(box.x, box.y);
await a.page.waitForSelector('.app.play', { timeout: 20000 });
const playingAt = Date.now() - nav0;
ok(playingAt < 10000, 'practising in under 10 s', `today's clip playing ${(playingAt / 1000).toFixed(1)} s after opening the URL`);
const scores = [];
for (let i = 0; i < units.length; i++) {
  await a.page.waitForSelector('.deck.prompt', { timeout: 25000 });
  if (i === 0) {
    console.log(`${stamp()} INFO  first "your turn" ${((Date.now() - nav0) / 1000).toFixed(1)} s after opening the URL (the first line lasts ${(units[0].t1 - (clip.start ?? units[0].t0)).toFixed(1)} s)`);
    await a.page.screenshot({ path: path.join(shots, '2-prompt.png') });
  }
  speak(jobs[i].out);
  await a.page.tap('#mic');
  if (i === 0) {
    await a.page.waitForTimeout(1500);
    await a.page.screenshot({ path: path.join(shots, '3-listening.png') });
  }
  await a.page.waitForSelector('.deck.feedback', { timeout: 25000 });
  scores.push(Number(await a.page.evaluate(() => document.querySelector('.fbscore').firstChild.textContent)));
  if (i === 0) {
    await a.page.waitForTimeout(600);
    await a.page.screenshot({ path: path.join(shots, '4-feedback.png') });
  }
  await a.page.tap('#next');
}
await a.page.waitForSelector('#result', { timeout: 10000 });
await a.page.waitForTimeout(2200);
await a.page.screenshot({ path: path.join(shots, '5-result.png') });
const shown = Number(await a.page.evaluate(() => document.querySelector('.big').textContent));
const mean = Math.round(scores.reduce((x, y) => x + y, 0) / scores.length);
ok(shown === mean, 'final score is the mean of the lines', `${scores.join(', ')} -> ${shown}`);
ok(shown >= 80, 'native TTS scores high on the web level', String(shown));
ok((await a.page.evaluate(() => document.querySelector('#streakchip').textContent.trim())) === '1', 'streak is 1 after the first clip');
const me1 = await a.page.evaluate(async () => {
  const S = JSON.parse(localStorage.getItem('dailyclips.v2'));
  return (await fetch('/api/me', { headers: { Authorization: 'Bearer ' + S.token } })).json();
});
ok(me1.results.length === 1 && me1.results[0].n === clip.n && !me1.user.google, 'result saved for the anonymous visitor', `alias ${me1.user && me1.user.alias}`);
ok(/1|primera|solo/.test(await a.page.evaluate(() => document.querySelector('#result').innerText)), 'result screen shows where you stand');

// ---- 2. test session: sign in, keep the anonymous result, see stats and ranking
if (secret) {
  const sub = 'e2e-' + Date.now().toString(36);
  const user = await a.page.evaluate(([s, id]) => window.dcTestLogin(s, id, 'Probador'), [secret, sub]);
  ok(user && user.google, 'test session signed in');
  const me2 = await a.page.evaluate(async () => {
    const S = JSON.parse(localStorage.getItem('dailyclips.v2'));
    return (await fetch('/api/me', { headers: { Authorization: 'Bearer ' + S.token } })).json();
  });
  ok(me2.results.length === 1 && me2.results[0].score === shown && me2.streak.current === 1, 'signing in keeps the anonymous result and streak', `score ${me2.results[0] && me2.results[0].score}, streak ${me2.streak.current}`);
  await a.page.tap('#streakchip');
  await a.page.waitForSelector('.sheet.in .facts', { timeout: 5000 });
  await a.page.waitForTimeout(500);
  const facts = await a.page.evaluate(() => ({
    streak: document.querySelector('.say').dataset.v,
    ...Object.fromEntries([...document.querySelectorAll('.facts [data-k]')].map((d) => [d.dataset.k, d.querySelector('b').textContent])),
  }));
  ok(facts.streak === '1' && facts.clips === '1' && facts.avg === String(shown), 'stats tab: streak, clips done and average', JSON.stringify(facts));
  await a.page.screenshot({ path: path.join(shots, '6-stats.png') });
  await a.page.tap('.tab[data-tab="rank"]');
  await a.page.waitForSelector('.sheet.in .rk', { timeout: 5000 });
  await a.page.waitForTimeout(500);
  const meRow = await a.page.evaluate(() => (document.querySelector('.rk.me') || {}).innerText || '');
  ok(/Probador/.test(meRow) && meRow.includes(String(shown)), 'ranking tab shows the signed-in user with their score', meRow.replace(/\s+/g, ' '));
  await a.page.screenshot({ path: path.join(shots, '7-ranking.png') });
  await a.page.tap('.tab[data-tab="clips"]');
  await a.page.waitForSelector('.sheet.in .arc', { timeout: 5000 });
  await a.page.waitForTimeout(400);
  await a.page.screenshot({ path: path.join(shots, '7b-clips.png') });
  await a.page.tap('.tab[data-tab="acct"]');
  await a.page.waitForTimeout(600);
  await a.page.screenshot({ path: path.join(shots, '7c-account.png') });
  await a.page.tap('#closesheet');
  await a.page.waitForTimeout(500);
} else console.log(`${stamp()} SKIP  test session (no --secret)`);

// ---- 3. share: the link carries the clip and the score to beat
await a.page.evaluate(() => {
  navigator.share = (d) => {
    window.__shared = d;
    return Promise.resolve();
  };
});
await a.page.evaluate(() => document.querySelector('#result').scrollTo(0, 0));
await a.page.tap('#share');
await a.page.waitForTimeout(300);
const shared = await a.page.evaluate(() => window.__shared);
ok(shared && shared.text.split('\n').length === 3 && shared.text.includes(`${shown}/100`) && shared.text.includes(clip.src || clip.title) && /🟩|🟨|🟥/u.test(shared.text),
  'share text: score and show, Wordle-style grid, a dare', shared && shared.text.replace(/\n/g, ' ⏎ '));
ok(shared && new RegExp(`/c/${clip.n}\\?vs=[a-z0-9]+`).test(shared.url), 'share link points at the same clip with the result to beat', shared && shared.url);
ok(errors.length === 0, 'no page errors for the first visitor', errors.join(' | '));
await a.context.close();

if (shared && shared.url) {
  const b = await launch({ headless });
  const html = await (await fetch(shared.url.replace(/^https?:\/\/[^/]+/, base))).text();
  ok(new RegExp(`og:title" content="[^"]*${shown}/100`).test(html), 'link preview names the score to beat', (/og:title" content="([^"]*)"/.exec(html) || [])[1]);
  const img = (/og:image" content="([^"]*)"/.exec(html) || [])[1] || '';
  const imgRes = await fetch(img.replace(/^https?:\/\/[^/]+/, base));
  ok(img.endsWith(`/${shown}.jpg`) && imgRes.ok && imgRes.headers.get('content-type') === 'image/jpeg', 'link preview shows the picture of that score', img);
  const plain = await (await fetch(`${base}/c/${clip.n}`)).text();
  ok(/og:image" content="[^"]*\/default\.jpg"/.test(plain), 'a plain link gets the default picture', (/og:title" content="([^"]*)"/.exec(plain) || [])[1]);
  await b.page.goto(shared.url.replace(/^https?:\/\/[^/]+/, base), { waitUntil: 'domcontentloaded' });
  await b.page.waitForSelector('.vsline', { timeout: 10000 });
  const txt = await b.page.evaluate(() => document.querySelector('.start').innerText);
  ok(txt.includes(String(shown)) && txt.includes(clip.title), 'second visitor lands on the same clip and sees the challenge', txt.replace(/\s+/g, ' ').slice(0, 90));
  await b.page.screenshot({ path: path.join(shots, '8-challenge.png') });
  await b.context.close();
}

console.log(`\n${failed ? failed + ' FAILED' : 'ALL PASSED'} in ${((Date.now() - t0) / 1000).toFixed(0)} s · screenshots in ${shots}`);
process.exit(failed ? 1 : 0);
