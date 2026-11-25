// Gateway to the Pro scoring service (scorer/server.py). The API never scores anything itself: it
// checks the subscription and the limits, hands the take to the scorer and passes the answer back.
// The audio is held in memory for the length of the request and never written anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dayOf } from './util.mjs';

const VOCAB = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scorer', 'vocab.json'), 'utf8'));
const MAX_SECONDS = 15;
const MAX_BYTES = MAX_SECONDS * 16000 * 2;
const PER_MINUTE = 20; // takes per user
const PER_DAY = 300;
const IN_FLIGHT = 6; // requests this process will hold at once; the scorer itself runs one and queues a few

export function createPro({ env, q, log, bad, isPro, clips, allow }) {
  const url = (env.DC_SCORER_URL || '').replace(/\/$/, '');
  const key = env.DC_SCORER_KEY || '';
  let inFlight = 0;

  async function score(req, m, reqUrl, { auth, readBody }) {
    const user = auth(req);
    if (!user) throw bad(401, 'no_user');
    if (!isPro(user)) throw bad(402, 'no_pro');
    if (!url) throw bad(503, 'busy');
    const clip = clips.get(Number(reqUrl.searchParams.get('n')));
    const phrase = clip && clip.phrases[Number(reqUrl.searchParams.get('p'))];
    if (!phrase || phrase.skip || !phrase.ph) throw bad(404, 'no_phrase');
    const size = Number(req.headers['content-length'] || 0);
    if (!size || size % 2) throw bad(400, 'bad_audio');
    if (size > MAX_BYTES) throw bad(413, 'too_long');
    const day = dayOf();
    const used = q('SELECT n FROM pro_usage WHERE user_id = ? AND day = ?').get(user.id, day);
    if ((used && used.n >= PER_DAY) || !allow('pro:' + user.id, PER_MINUTE, 60e3)) throw bad(429, 'limit');
    if (inFlight >= IN_FLIGHT) throw bad(503, 'busy');
    inFlight++;
    try {
      const pcm = await readBody(req, MAX_BYTES);
      const ids = phrase.ph.flat().map((p) => VOCAB[p]);
      let r;
      try {
        r = await fetch(`${url}/score?ph=${ids.join(',')}`, {
          method: 'POST', body: pcm, signal: AbortSignal.timeout(22000),
          headers: { 'Content-Type': 'application/octet-stream', 'X-Scorer-Key': key },
        });
      } catch (e) {
        log('scorer unreachable:', e.message);
        throw bad(503, 'busy');
      }
      if (r.status === 503) throw bad(503, 'busy');
      if (!r.ok) {
        log('scorer answered', r.status);
        throw bad(r.status === 400 || r.status === 413 ? 400 : 502, 'scorer_error');
      }
      const out = await r.json();
      q(`INSERT INTO pro_usage (user_id, day, n) VALUES (?, ?, 1)
         ON CONFLICT(user_id, day) DO UPDATE SET n = n + 1`).run(user.id, day);
      return { rows: out.rows, extra: out.extra, ms: out.ms, wait: out.wait_ms };
    } finally {
      inFlight--;
    }
  }

  return {
    enabled: () => !!url,
    routes(route, helpers) {
      route('POST', /^\/api\/pro\/score$/, (req, m, reqUrl) => score(req, m, reqUrl, helpers));
    },
  };
}
