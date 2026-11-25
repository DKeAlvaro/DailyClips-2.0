#!/usr/bin/env node
// Pro, end to end, against a staging instance whose Stripe keys are TEST keys:
//   without Pro the scoring endpoint refuses · pay once with a test card in Stripe Checkout · the account
//   becomes Pro and the server scores a take · it cannot be bought twice · the payment is refunded
//   (through the API) and the endpoint refuses again.
//
//   node tests/pro.mjs --base https://staging.example --secret <DC_TEST_AUTH> --stripe-key sk_test_... [--headed]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch, speak } from './lib/browser.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? def : process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true;
};
const base = String(arg('base', '')).replace(/\/$/, '');
const secret = arg('secret', '');
const stripeKey = String(arg('stripe-key', ''));
const shots = arg('shots', 'work/pro-shots');
if (!base || !secret || !stripeKey.startsWith('sk_test_')) {
  console.error('needs --base, --secret and a TEST --stripe-key');
  process.exit(2);
}
fs.mkdirSync(shots, { recursive: true });

let failed = 0;
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5) + 's';
const ok = (cond, what, extra = '') => {
  if (!cond) failed++;
  console.log(`${stamp()} ${cond ? 'PASS' : 'FAIL'}  ${what}${extra ? '  (' + extra + ')' : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripe = async (method, p) => (await fetch('https://api.stripe.com/v1' + p, { method, headers: { Authorization: 'Bearer ' + stripeKey } })).json();

const health = await (await fetch(base + '/api/health')).json();
const { clip } = await (await fetch(`${base}/api/clip/${health.today}`)).json();
const idx = clip.phrases.findIndex((p) => !p.skip && p.ph);
const unit = clip.phrases[idx];
// a native voice saying the first line: 16 kHz for the API, 48 kHz for the fake microphone
const dir = path.resolve('work/pro-audio');
fs.mkdirSync(dir, { recursive: true });
const jobs = [
  { text: unit.text, voice: 'en-US-GuyNeural', out: path.join(dir, 'api.wav'), rate: 16000, pad: 0.3 },
  { text: unit.text, voice: 'en-US-GuyNeural', out: path.join(dir, 'mic.wav'), rate: 48000, pad: 0.7 },
];
fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(jobs));
spawnSync('python', ['tools/tts.py', path.join(dir, 'jobs.json')], { windowsHide: true });
const wav = fs.readFileSync(jobs[0].out);
const pcm = wav.subarray(wav.indexOf('data') + 8);
console.log(`${stamp()} ${base} · clip #${clip.n}, line "${unit.text}" (${(pcm.length / 32000).toFixed(1)} s of audio)`);

const { context, page } = await launch({ headless: !arg('headed', false) });
const errors = [];
const proCalls = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
page.on('response', (r) => {
  if (r.url().includes('/api/pro/score')) proCalls.push(r.status());
});
await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.app.ready', { timeout: 20000 });
const sub = 'pro-' + Date.now().toString(36);
const user = await page.evaluate(([s, id]) => window.dcTestLogin(s, id, 'Pagador'), [secret, sub]);
const token = await page.evaluate(() => JSON.parse(localStorage.getItem('dailyclips.v2')).token);
const me = async () => (await (await fetch(base + '/api/me', { headers: { Authorization: 'Bearer ' + token } })).json()).user;
const score = async () => {
  const t = Date.now();
  const r = await fetch(`${base}/api/pro/score?n=${clip.n}&p=${idx}`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' }, body: pcm,
  });
  return { status: r.status, ms: Date.now() - t, body: await r.json().catch(() => null) };
};
ok(user && user.google && !user.pro.active, 'signed in, not Pro');

// ---- 1. without Pro the endpoint refuses
let r = await score();
ok(r.status === 402, 'scoring endpoint refuses an account without Pro', `HTTP ${r.status} ${r.body && r.body.error}`);
const anon = (await fetch(`${base}/api/pro/score?n=${clip.n}&p=${idx}`, { method: 'POST', body: pcm })).status;
ok(anon === 401, 'and refuses a request with no account at all', `HTTP ${anon}`);

// ---- 2. pay with a test card
const openAccount = async () => {
  await page.tap('#menu');
  await page.waitForSelector('.sheet.in', { timeout: 5000 });
  await page.tap('.tab[data-tab="acct"]');
};
await openAccount();
await page.waitForSelector('#gopro', { timeout: 5000 });
await page.evaluate(() => document.querySelector('#gopro').scrollIntoView({ block: 'center' }));
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(shots, '1-card.png') });
await page.tap('#gopro');
await page.waitForURL(/checkout\.stripe\.com/, { timeout: 20000 });
await page.waitForLoadState('domcontentloaded');
// Checkout draws its form inside one of Stripe's frames: find it by the card option and work in there
let form = null;
for (let i = 0; i < 40 && !form; i++) {
  await page.waitForTimeout(500);
  for (const f of page.frames()) {
    if (await f.getByText(/^(Tarjeta|Card)$/).count().catch(() => 0)) form = f;
  }
}
if (!form) throw new Error('Stripe Checkout did not show a card option');
await page.screenshot({ path: path.join(shots, '2-checkout.png') });
const number = form.locator('#payment-numberInput');
if (!(await number.isVisible().catch(() => false))) await form.getByText(/^(Tarjeta|Card)$/).first().click();
await number.waitFor({ timeout: 20000 });
await number.fill('4242 4242 4242 4242');
await form.locator('#payment-expiryInput').fill('12 / 34');
await form.locator('#payment-cvcInput').fill('123');
if (await form.locator('#payment-nameInput').isVisible().catch(() => false)) await form.locator('#payment-nameInput').fill('Test Payer');
if (await form.locator('#payment-countryInput').isVisible().catch(() => false)) await form.locator('#payment-countryInput').selectOption('ES').catch(() => {});
if (await form.locator('#payment-postalCodeInput').isVisible().catch(() => false)) await form.locator('#payment-postalCodeInput').fill('28001');
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(shots, '3-filled.png') });
await form.locator('[data-testid="payment-form-submit-button"]').click();
let back = true;
await page.waitForURL((u) => String(u).startsWith(base), { timeout: 60000 }).catch(() => {
  back = false;
});
if (!back) await page.screenshot({ path: path.join(shots, '3-stuck.png') });
ok(back, 'test card accepted by Stripe Checkout, back in the app');

// ---- 3. the account is Pro and the server scores
await page.waitForSelector('.app.ready', { timeout: 20000 });
let u = null;
for (let i = 0; i < 20 && !(u && u.pro.active); i++) {
  await sleep(1000);
  u = await me();
}
ok(u.pro.active, 'the account is Pro', `status ${u.pro.status}`);
await page.waitForTimeout(2500);
ok(await page.evaluate(() => JSON.parse(localStorage.getItem('dailyclips.v2')).tier === 'pro'), 'the app switched itself to the Pro level');
await page.screenshot({ path: path.join(shots, '4-back.png') });
r = await score();
ok(r.status === 200 && r.body.rows.length === unit.ph.flat().length, 'scoring endpoint accepts the Pro account',
  `HTTP ${r.status}, ${r.body && r.body.rows && r.body.rows.length} phonemes, model ${r.body && r.body.ms} ms, whole request ${r.ms} ms`);
// a real take through the app: fake microphone -> recorded -> sent to the server -> coloured words
const box = await page.evaluate(() => {
  const b = document.querySelector('.yt iframe').getBoundingClientRect();
  return { x: b.x + b.width / 2, y: Math.min(b.y + b.height / 2, innerHeight * 0.46) };
});
await page.touchscreen.tap(box.x, box.y);
await page.waitForSelector('.deck.prompt', { timeout: 40000 });
speak(jobs[1].out);
const tapAt = Date.now();
await page.tap('#mic');
await page.waitForSelector('.deck.feedback', { timeout: 40000 });
const took = Date.now() - tapAt;
const shown = await page.evaluate(() => document.querySelector('.fbscore').firstChild.textContent);
ok(proCalls.includes(200), 'a take in the app is scored by the server',
  `score ${shown}; ${(took / 1000).toFixed(1)} s from tapping the mic to the coloured words, the line itself lasts ${(pcm.length / 32000).toFixed(1)} s`);
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(shots, '5-pro-feedback.png') });

// ---- 4. it is a single payment: nothing to cancel, and it cannot be bought twice
await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.app.ready', { timeout: 20000 });
await openAccount();
await page.waitForSelector('.tier.on', { timeout: 8000 });
await page.evaluate(() => document.querySelector('.tier.on').scrollIntoView({ block: 'center' }));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(shots, '6-pro-card.png') });
ok(!(await page.$('#gopro')), 'the Pro card no longer offers to buy');
const again = await fetch(base + '/api/billing/checkout', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}' });
ok(again.status === 409, 'a second purchase is refused', `HTTP ${again.status}`);

// ---- 5. the payment is refunded: Pro goes with it
const customers = await stripe('GET', '/customers?limit=3&email=' + encodeURIComponent(u.email));
const pis = customers.data && customers.data[0] ? await stripe('GET', '/payment_intents?customer=' + customers.data[0].id) : { data: [] };
ok(pis.data.length === 1 && pis.data[0].status === 'succeeded', 'Stripe has one payment for this customer, no subscription', pis.data[0] && `${pis.data[0].amount / 100} ${pis.data[0].currency}`);
if (pis.data[0]) await fetch('https://api.stripe.com/v1/refunds', { method: 'POST', headers: { Authorization: 'Bearer ' + stripeKey }, body: new URLSearchParams({ payment_intent: pis.data[0].id }) });
for (let i = 0; i < 25 && u.pro.active; i++) {
  await sleep(1000);
  u = await me();
}
ok(!u.pro.active, 'refunded at Stripe: the webhook switched Pro off', `status ${u.pro.status}`);
r = await score();
ok(r.status === 402, 'scoring endpoint refuses the account again', `HTTP ${r.status}`);
ok(!errors.length, 'no page errors', errors.join(' | '));
await context.close();
console.log(`\n${failed ? failed + ' FAILED' : 'ALL PASSED'} in ${Math.round((Date.now() - t0) / 1000)} s · screenshots in ${shots}`);
process.exit(failed ? 1 : 0);
