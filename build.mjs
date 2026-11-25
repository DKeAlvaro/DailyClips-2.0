// Builds web/ into dist/: one hashed JS bundle (+ lazy chunks), CSS inlined in the HTML, static files copied.
import { build, transform } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'web');
const out = path.join(root, 'dist');
const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
fs.cpSync(path.join(src, 'static'), out, { recursive: true });

const font = fs.readFileSync(path.join(src, 'fonts', 'bricolage.woff2'));
const fontName = `bricolage.${hash(font)}.woff2`;
fs.writeFileSync(path.join(out, 'assets', fontName), font);

const res = await build({
  entryPoints: [path.join(src, 'src', 'main.js')],
  bundle: true, format: 'esm', splitting: true, minify: !process.env.DC_DEV, sourcemap: process.env.DC_DEV ? 'inline' : false, target: ['es2020'],
  outdir: path.join(out, 'assets'), entryNames: 'app.[hash]', chunkNames: 'chunk.[hash]',
  metafile: true, legalComments: 'none', logLevel: 'warning',
});
const entry = Object.entries(res.metafile.outputs).find(([, o]) => o.entryPoint)[0];
const jsName = path.basename(entry);

const css = (await transform(fs.readFileSync(path.join(src, 'styles.css'), 'utf8'), { loader: 'css', minify: true })).code
  .replaceAll('__FONT__', fontName);

for (const page of ['index.html']) {
  const html = fs.readFileSync(path.join(src, page), 'utf8')
    .replaceAll('__CSS__', () => css).replaceAll('__JS__', jsName).replaceAll('__FONT__', fontName);
  fs.writeFileSync(path.join(out, page), html);
}

const size = (f) => (fs.statSync(f).size / 1024).toFixed(1) + ' kB';
console.log(`dist/index.html ${size(path.join(out, 'index.html'))} · assets/${jsName} ${size(path.join(out, 'assets', jsName))} · font ${size(path.join(out, 'assets', fontName))}`);
