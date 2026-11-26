// Renders the link-preview images into web/static/assets/og<V>/ (run once, results are committed):
//   <score>.jpg for 0..100, used when a shared link carries ?vs=<result> ("92 vs ?"), and default.jpg.
//   node tools/make-og.mjs
// 1200x630 JPEG. Everything that matters sits in the centre 630x630 square, because WhatsApp crops
// small previews to a square. Files under /assets/ are cached for a year: when the drawing changes,
// bump V here and OG_V in server/api.mjs, and delete the old folder.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ART } from '../web/src/mascot.js';

const V = 1;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'web/static/assets', 'og' + V);
const fontFile = fs.readdirSync(path.join(root, 'web/fonts')).find((f) => f.endsWith('.woff2'));
const font = fs.readFileSync(path.join(root, 'web/fonts', fontFile)).toString('base64');
const C = { g: '#b9f33f', c: '#ffc53d', m: '#ff7a66', ink: '#f6f4ec', dim: '#6f7065', bg: '#0b0c0a' };
const band = (s) => (s >= 80 ? 'g' : s >= 50 ? 'c' : 'm');

// a sound wave on each side, outside the square: it only shows in the wide preview
const wave = (side, tint) => {
  const hs = [0.25, 0.5, 0.35, 0.8, 0.55, 1, 0.7, 0.4, 0.9, 0.5, 0.3, 0.6, 0.2];
  const bars = hs.map((v, i) => {
    const o = side === 'l' ? 0.2 + (i / hs.length) * 0.6 : 0.8 - (i / hs.length) * 0.6;
    return `<i style="height:${Math.round(40 + v * 300)}px;opacity:${o.toFixed(2)};background:${i % 4 === 3 ? C.c : tint}"></i>`;
  });
  return `<div class="wave ${side}">${bars.join('')}</div>`;
};

const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:D;src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:100 900}
html,body{margin:0;width:1200px;height:630px;background:${C.bg};overflow:hidden}
body{font-family:D,sans-serif;color:${C.ink};position:relative}
.sq{position:absolute;left:285px;top:0;width:630px;height:630px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.brand{font-weight:800;font-size:46px;letter-spacing:-.02em}.brand b{color:${C.g};font-weight:800}
.wave{position:absolute;top:0;bottom:0;width:250px;display:flex;align-items:center;gap:9px}
.wave.l{left:24px}.wave.r{right:24px;justify-content:flex-end}
.wave i{display:block;width:10px;border-radius:5px}
${fs.readFileSync(path.join(root, 'web/mascot.css'), 'utf8')}
.mascot *{animation:none!important}
</style></head><body>${body}</body></html>`;

// the mascot (web/src/mascot.js), as drawn in the app
const girl = (mood, size) => ART.replace('<svg ', `<svg data-mood="${mood}" width="${size}" height="${size}" `);

const vs = (s) => page(`${wave('l', C[band(s)])}${wave('r', C[band(s)])}
<div class="sq">
  <div class="brand">Daily<b>Clips</b></div>
  <div style="display:flex;align-items:baseline;justify-content:center;gap:26px;margin:18px 0 6px;font-weight:900;font-size:${s === 100 ? 210 : 250}px;line-height:1;letter-spacing:-.05em;font-variant-numeric:tabular-nums">
    <span style="color:${C[band(s)]}">${s}</span><span style="font-size:64px;color:${C.dim};letter-spacing:0;font-weight:800">vs</span><span>?</span>
  </div>
  <div style="font-weight:800;font-size:76px;letter-spacing:-.03em">${s === 100 ? '¿Lo igualas?' : '¿Le ganas?'}</div>
</div>`);

// the plain link: the mascot over the name, a line already scored word by word, and the question
const plain = () => {
  const words = [['Even', 'g'], ['if', 'g'], ['I', 'g'], ['wanted', 'c'], ['to', 'g'], ['go,', 'g'], ['my', 'g'], ['schedule…', 'm']];
  return page(`${wave('l', C.g)}${wave('r', C.g)}
<div class="sq">
  ${girl(process.env.OG_MOOD || 'happy', 150)}
  <div class="brand" style="margin-top:4px">Daily<b>Clips</b></div>
  <div style="font-weight:800;font-size:54px;line-height:1.2;letter-spacing:-.02em;margin:24px 10px 22px">${words.map(([w, c]) => `<span style="color:${C[c]};${c === 'm' ? `text-decoration:underline wavy ${C.m} 4px;text-underline-offset:12px;` : ''}">${w}</span>${w === 'go,' ? '<br>' : ''}`).join(' ')}</div>
  <div style="font-weight:900;font-size:88px;line-height:1;letter-spacing:-.04em">¿Cuánto <span style="color:${C.g}">sacas</span>?</div>
</div>`);
};

fs.mkdirSync(out, { recursive: true });
const only = process.argv[2]; // e.g. "87,default" to redraw a few while tuning
const want = (k) => !only || only.split(',').includes(String(k));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const p = await browser.newPage({ viewport: { width: 1200, height: 630 } });
let total = 0;
const shot = async (html, name) => {
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  const file = path.join(out, name);
  await p.screenshot({ path: file, type: 'jpeg', quality: 72 });
  total += fs.statSync(file).size;
};
if (want('default')) await shot(plain(), 'default2.jpg'); // default.jpg (no mascot) stays for links already cached with it
for (let s = 0; s <= 100; s++) if (want(s)) await shot(vs(s), s + '.jpg');
await browser.close();
console.log(`og images written to ${path.relative(root, out)} · ${(total / 1024).toFixed(0)} kB`);
