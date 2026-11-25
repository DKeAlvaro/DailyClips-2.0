// Fails when COUNTS in web/src/voice.js, tools/voice/lines.json and the MP3s disagree: node tools/voice/check.mjs
import fs from 'node:fs';
const want = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(new URL('lines.json', import.meta.url))).lines).map(([k, v]) => [k, v.length]));
const got = Object.fromEntries([...fs.readFileSync(new URL('../../web/src/voice.js', import.meta.url), 'utf8').match(/COUNTS = \{([^}]*)\}/)[1].matchAll(/(\w+): (\d+)/g)].map((m) => [m[1], +m[2]]));
const missing = Object.entries(want).flatMap(([k, n]) => Array.from({ length: n }, (_, i) => `${k}-${i + 1}.mp3`)).filter((f) => !fs.existsSync(new URL('../../web/static/assets/voice1/' + f, import.meta.url)));
if (JSON.stringify(got) !== JSON.stringify(want) || missing.length) { console.error('voice.js COUNTS', got, '\nlines.json', want, '\nmissing', missing); process.exit(1); }
console.log('voice ok:', Object.keys(want).length, 'moments,', Object.values(want).reduce((a, b) => a + b), 'lines');
