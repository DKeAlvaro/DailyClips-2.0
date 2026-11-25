// Renders the app icons and the link-preview image into web/static/ (run once, results are committed).
//   node tools/make-icons.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const font = fs.readFileSync(path.join(root, 'web/fonts/gabarito.woff2')).toString('base64');
const mark = (size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"><rect width="64" height="64" rx="${pad ? 0 : 15}" fill="#0a0b0d"/><g transform="${pad ? 'translate(8 8) scale(.75)' : ''}"><path d="M24 19v26a2 2 0 0 0 3 1.7l21-13a2 2 0 0 0 0-3.4L27 17.3A2 2 0 0 0 24 19Z" fill="#b9f33f"/><rect x="12" y="24" width="5" height="16" rx="2.5" fill="#b9f33f" opacity=".55"/></g></svg>`;
const page = (body, w, h) => `<!doctype html><html><head><style>
@font-face{font-family:B;src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:200 800}
html,body{margin:0;width:${w}px;height:${h}px;background:#0a0b0d;overflow:hidden}</style></head><body>${body}</body></html>`;
const og = `<div style="position:absolute;inset:0;padding:74px 84px;font-family:B;color:#f5f6f1;display:flex;flex-direction:column;justify-content:space-between">
  <div style="display:flex;align-items:center;gap:22px;font-size:54px;font-weight:700;letter-spacing:-.02em">${mark(84)}<span>Daily<span style="color:#b9f33f">Clips</span></span></div>
  <div>
    <div style="font-size:106px;line-height:.96;font-weight:800;letter-spacing:-.045em">Say it like<br>the clip.</div>
    <div style="display:flex;gap:12px;margin-top:44px">${['#b9f33f', '#b9f33f', '#ffc53d', '#b9f33f', '#ff6f61', '#b9f33f'].map((c) => `<i style="width:92px;height:20px;border-radius:6px;background:${c}"></i>`).join('')}</div>
    <div style="font-size:34px;color:#a2a59c;margin-top:30px;font-weight:500">A new clip every day. Repeat the lines, get your score, beat your friends.</div>
  </div>
  <div style="position:absolute;right:84px;top:64px;font-size:190px;font-weight:800;letter-spacing:-.06em;color:#b9f33f;line-height:1">87<span style="font-size:44px;color:#6d7069;letter-spacing:0;vertical-align:top;position:relative;top:26px">/100</span></div>
</div>`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const shot = async (html, w, h, file) => {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(root, 'web/static', file), type: 'png' });
  await p.close();
};
await shot(page(mark(180, true), 180, 180), 180, 180, 'icon-180.png');
await shot(page(mark(192, true), 192, 192), 192, 192, 'icon-192.png');
await shot(page(mark(512, true), 512, 512), 512, 512, 'icon-512.png');
await shot(page(og, 1200, 630), 1200, 630, 'assets/og.png');
await browser.close();
fs.writeFileSync(path.join(root, 'web/static/favicon.svg'), mark(64).replace(' width="64" height="64"', '') + '\n');
console.log('icons written');
