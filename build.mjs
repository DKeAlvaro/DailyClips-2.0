// Builds web/ into dist/: one hashed JS bundle (+ lazy chunks), CSS inlined in the HTML, static files copied.
import { build, transform } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'web');
const out = path.join(root, 'dist');
const tmp = path.join(root, 'dist.tmp');
const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);

// build next to the live folder and swap at the end, so a deploy never serves a half-written dist/
const live = out;
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(path.join(tmp, 'assets'), { recursive: true });
fs.cpSync(path.join(src, 'static'), tmp, { recursive: true });

const font = fs.readFileSync(path.join(src, 'fonts', 'gabarito.woff2'));
const fontName = `gabarito.${hash(font)}.woff2`;
fs.writeFileSync(path.join(tmp, 'assets', fontName), font);

const res = await build({
  entryPoints: [path.join(src, 'src', 'main.js')],
  bundle: true, format: 'esm', splitting: true, minify: !process.env.DC_DEV, sourcemap: process.env.DC_DEV ? 'inline' : false, target: ['es2020'],
  outdir: path.join(tmp, 'assets'), entryNames: 'app.[hash]', chunkNames: 'chunk.[hash]',
  metafile: true, legalComments: 'none', logLevel: 'warning',
});
const entry = Object.entries(res.metafile.outputs).find(([, o]) => o.entryPoint)[0];
const jsName = path.basename(entry);
// shared chunks the entry imports right away: preload them so they do not wait for the entry to be parsed
const eager = new Set();
const walk = (file) => {
  for (const imp of res.metafile.outputs[file].imports || []) {
    if (imp.kind !== 'import-statement' || eager.has(imp.path)) continue;
    eager.add(imp.path);
    walk(imp.path);
  }
};
walk(entry);
const preload = [...eager].map((f) => `<link rel="modulepreload" href="/assets/${path.basename(f)}">`).join('');

const css = (await transform(fs.readFileSync(path.join(src, 'styles.css'), 'utf8'), { loader: 'css', minify: true })).code
  .replaceAll('__FONT__', fontName);

for (const page of ['index.html']) {
  const html = fs.readFileSync(path.join(src, page), 'utf8')
    .replaceAll('__CSS__', () => css).replaceAll('__JS__', jsName).replaceAll('__FONT__', fontName).replaceAll('__PRELOAD__', preload);
  fs.writeFileSync(path.join(tmp, page), html);
}

// pre-compressed copies so the web server does not compress on every request
for (const f of fs.readdirSync(path.join(tmp, 'assets'))) {
  if (!/\.(js|css|svg|json)$/.test(f)) continue;
  const buf = fs.readFileSync(path.join(tmp, 'assets', f));
  fs.writeFileSync(path.join(tmp, 'assets', f + '.br'), zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));
  fs.writeFileSync(path.join(tmp, 'assets', f + '.gz'), zlib.gzipSync(buf, { level: 9 }));
}

// pages that were loaded before this deploy may still ask for the previous hashed files: keep them two weeks
if (fs.existsSync(path.join(live, 'assets'))) {
  for (const f of fs.readdirSync(path.join(live, 'assets'))) {
    const from = path.join(live, 'assets', f), to = path.join(tmp, 'assets', f);
    if (!fs.existsSync(to) && Date.now() - fs.statSync(from).mtimeMs < 14 * 86400e3) fs.cpSync(from, to, { preserveTimestamps: true });
  }
}
fs.rmSync(live, { recursive: true, force: true });
fs.renameSync(tmp, live);

const size = (f) => (fs.statSync(f).size / 1024).toFixed(1) + ' kB';
const gz = (f) => (zlib.gzipSync(fs.readFileSync(f)).length / 1024).toFixed(1) + ' kB gzip';
const J = path.join(out, 'assets', jsName), H = path.join(out, 'index.html');
console.log(`index.html ${size(H)} (${gz(H)}) · ${jsName} ${size(J)} (${gz(J)}) · font ${size(path.join(out, 'assets', fontName))}`);
