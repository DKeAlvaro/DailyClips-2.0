#!/usr/bin/env node
// Sanity check and timing of the on-device level, in a real browser with the app's own code:
// every reference audio is scored by the model running in ONNX Runtime Web.
//   node tests/ref/device.mjs [--base http://localhost:8821] [--throttle 4] [--model work/models/student_q4.onnx]
// --throttle N runs the model on the page's main thread under an N x CPU slowdown (how a phone feels).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { launch } from '../lib/browser.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const base = arg('base', 'http://localhost:8821');
const throttle = Number(arg('throttle', 0));
const modelFile = arg('model', 'work/models/student_q4.onnx');
const dir = path.resolve('work/ref');
const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const phones = JSON.parse(fs.readFileSync(path.join(dir, 'phones.json'), 'utf8'));
const texts = JSON.parse(fs.readFileSync('tests/ref/phrases.json', 'utf8'));

const pcmOf = (file) => {
  const buf = fs.readFileSync(path.join(dir, file));
  const data = buf.subarray(buf.indexOf('data') + 8);
  return Array.from(new Int16Array(data.buffer, data.byteOffset, data.length >> 1), (v) => v / 32768);
};

const bundle = await build({ entryPoints: ['web/src/tier-device.js'], bundle: true, format: 'iife', globalName: 'DC', write: false, logLevel: 'silent' });
const { context, page } = await launch({ headless: true });
// the model normally comes from Hugging Face; the test serves the same file from disk
await context.route('**/xlsr-53-espeak-student-ONNX/resolve/**', (route) => route.fulfill({ path: modelFile, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } }));
const net = { ort: 0, files: [] };
page.on('response', async (r) => {
  if (!r.url().includes('onnxruntime-web')) return;
  const len = Number((await r.allHeaders())['content-length'] || 0);
  net.ort += len;
  net.files.push(path.basename(new URL(r.url()).pathname) + ' ' + (len / 1e6).toFixed(2) + ' MB');
});
await page.goto(base + '/robots.txt');
await page.addScriptTag({ content: bundle.outputFiles[0].text });
if (throttle) {
  await page.evaluate(() => window.DC.useMainThread());
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
}
let t = Date.now();
await page.evaluate(() => window.DC.downloadModel());
await page.evaluate(() => window.DC.loadModel());
console.log(`model in memory after ${((Date.now() - t) / 1000).toFixed(1)} s${throttle ? ` (CPU x${throttle} slower, main thread)` : ' (worker)'}; model file ${(fs.statSync(modelFile).size / 1e6).toFixed(1)} MB; runtime ${net.files.join(', ')}`);

const score = (unit, file) => page.evaluate(([u, pcm]) => window.DC.scoreAudio(u, new Float32Array(pcm)), [unit, pcmOf(file)]);
const out = [];
const n = texts.length;
for (let i = 0; i < n; i++) {
  const unit = { text: texts[i], ph: phones[i] };
  // native reference: the male native voice decides which phones count, as tools/prep/refs.py does per clip
  const ref = await score(unit, `${i}-native-m.wav`);
  let mask = ref.rows.map((r) => (r.gop != null && r.gop >= -4 ? '1' : '0')).join('');
  if ((mask.match(/1/g) || []).length < Math.max(3, mask.length / 3)) mask = '1'.repeat(mask.length);
  unit.m = { dev: mask };
  for (const item of index.filter((x) => x.phrase === i)) {
    const r = await score(unit, item.file);
    out.push({ ...item, score: r.score, ms: r.ms, seconds: pcmOf(item.file).length / 16000 });
  }
}
await context.close();
fs.writeFileSync(path.join(dir, throttle ? `device-x${throttle}.json` : 'device.json'), JSON.stringify(out, null, 1));

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
console.log(`time per phrase: mean ${Math.round(mean(ms))} ms, max ${Math.max(...ms)} ms, for audio of ${mean(secs).toFixed(1)} s on average (x${(mean(ms) / 1000 / mean(secs)).toFixed(2)} realtime)`);
