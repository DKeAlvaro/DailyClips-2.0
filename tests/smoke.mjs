#!/usr/bin/env node
// Read-only check of a live deployment: the page loads, the video starts on a tap, the first
// "your turn" shows up and one take is scored (a stand-in recogniser repeats the line; the web level
// scores in the browser and an unfinished clip is never uploaded). Safe to run against production.
//   node tests/smoke.mjs --base https://llmers.es [--shots dir]
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './lib/browser.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const base = String(arg('base', 'https://llmers.es')).replace(/\/$/, '');
const shots = arg('shots', 'work/smoke');
fs.mkdirSync(shots, { recursive: true });
const { context, page } = await launch({ headless: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const voice = [];
page.on('request', (r) => { if (r.url().includes('/assets/voice1/')) voice.push(r.url().replace(/^.*\//, '')); });
await context.addInitScript(() => {
  class FakeSR {
    start() {
      setTimeout(() => this.onstart && this.onstart(), 30);
      this._t = setTimeout(() => {
        const r = [{ transcript: window.__said || '' }];
        r.isFinal = true;
        this.onresult && this.onresult({ results: [r] });
      }, 900);
    }
    stop() { setTimeout(() => this.onend && this.onend(), 30); }
    abort() { clearTimeout(this._t); }
  }
  window.SpeechRecognition = window.webkitSpeechRecognition = FakeSR;
});
const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(1) + ' s';
await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
console.log('html', at());
await page.waitForSelector('.app.ready', { timeout: 20000 });
console.log('player ready', at(), '|', await page.evaluate(() => document.querySelector('.start').innerText.replace(/\s+/g, ' ')));
await page.screenshot({ path: path.join(shots, 'start.png') });
const box = await page.evaluate(() => { const r = document.querySelector('.yt iframe').getBoundingClientRect(); return { x: r.x + r.width / 2, y: Math.min(r.y + r.height / 2, innerHeight * 0.46) }; });
await page.touchscreen.tap(box.x, box.y);
await page.waitForSelector('.app.play', { timeout: 15000 });
console.log('video playing', at());
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(shots, 'playing.png') });
await page.waitForSelector('.deck.prompt', { timeout: 25000 });
console.log('first "your turn"', at());
await page.screenshot({ path: path.join(shots, 'prompt.png') });
await page.evaluate(() => { window.__said = document.querySelector('.phrase').innerText; });
await page.tap('#mic');
await page.waitForSelector('.deck.feedback', { timeout: 15000 });
await page.waitForTimeout(1200);
console.log('first take', at(), '| score', await page.evaluate(() => document.querySelector('.fbscore').textContent),
  '| mascot', await page.evaluate(() => document.querySelector('.deck .mascot')?.dataset.mood || 'none'), '| voice', voice.join(' ') || 'none');
await page.screenshot({ path: path.join(shots, 'feedback.png') });
await page.tap('#menu');
await page.waitForSelector('.sheet.in', { timeout: 5000 });
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(shots, 'ranking.png') });
await page.tap('.tab[data-tab="acct"]');
await page.waitForTimeout(2500);
console.log('google button rendered:', await page.evaluate(() => !!document.querySelector('.gbtn iframe, .gbtn [role=button]')));
await page.screenshot({ path: path.join(shots, 'account.png') });
console.log(errors.length ? 'PAGE ERRORS: ' + errors.join(' | ') : 'no page errors');
await context.close();
