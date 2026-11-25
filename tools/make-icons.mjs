// Renders the app icons into web/static/ (run once, results are committed). Link previews: tools/make-og.mjs.
//   node tools/make-icons.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mark = (size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"><rect width="64" height="64" rx="${pad ? 0 : 15}" fill="#0a0b0d"/><g transform="${pad ? 'translate(8 8) scale(.75)' : ''}"><path d="M24 19v26a2 2 0 0 0 3 1.7l21-13a2 2 0 0 0 0-3.4L27 17.3A2 2 0 0 0 24 19Z" fill="#b9f33f"/><rect x="12" y="24" width="5" height="16" rx="2.5" fill="#b9f33f" opacity=".55"/></g></svg>`;
const page = (body, w, h) => `<!doctype html><html><head><style>
html,body{margin:0;width:${w}px;height:${h}px;background:#0a0b0d;overflow:hidden}</style></head><body>${body}</body></html>`;
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
await browser.close();
fs.writeFileSync(path.join(root, 'web/static/favicon.svg'), mark(64).replace(' width="64" height="64"', '') + '\n');
console.log('icons written');
