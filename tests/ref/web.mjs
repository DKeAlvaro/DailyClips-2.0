#!/usr/bin/env node
// Runs every reference audio through the web level (Chrome's speech recogniser + the app's own
// comparison code) and writes work/ref/web.json. Real Chrome, fake microphone.
//   node tests/ref/web.mjs [--base http://localhost:8821]
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { launch, speak } from '../lib/browser.mjs';

const i = process.argv.indexOf('--base');
const base = i > 0 ? process.argv[i + 1] : 'http://localhost:8821';
const dir = path.resolve('work/ref');
const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const outFile = path.join(dir, 'web.json');
const done = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : [];

const bundle = await build({ entryPoints: ['web/src/tier-web.js'], bundle: true, format: 'iife', globalName: 'DC', write: false });
const { context, page } = await launch({ headless: true });
await page.goto(base + '/robots.txt');
await page.addScriptTag({ content: bundle.outputFiles[0].text });

for (const item of index) {
  if (done.find((d) => d.phrase === item.phrase && d.voice === item.voice && d.cond === item.cond)) continue;
  speak(path.join(dir, item.file));
  const t0 = Date.now();
  const r = await page.evaluate((text) => window.DC.listenWeb(text, { maxMs: 14000 }).promise, item.text);
  done.push({ ...item, score: r.ok ? r.score : 0, heard: r.ok ? r.heard : '(' + r.why + ')', ms: Date.now() - t0 });
  fs.writeFileSync(outFile, JSON.stringify(done, null, 1));
  console.log(`${item.phrase} ${item.cond.padEnd(7)} ${item.voice.padEnd(9)} ${String(r.ok ? r.score : 0).padStart(3)}  ${r.ok ? r.heard : '(' + r.why + ')'}`);
}
await context.close();

const mean = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
for (const cond of ['native', 'spanish', 'other']) console.log(cond, mean(done.filter((d) => d.cond === cond).map((d) => d.score)));
