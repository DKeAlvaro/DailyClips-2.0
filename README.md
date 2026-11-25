# DailyClips

Practise English pronunciation with one short clip a day. The video stops after every line, you repeat it
into the mic, each word is coloured by how you said it and you get a score. Same clip for everyone, a new
one every day, with streaks, stats, a ranking and a Wordle-style share.

Live at https://llmers.es

## Three ways of scoring, one scale

| Level | What it scores | Where it runs | Cost |
| --- | --- | --- | --- |
| Web (default) | words, with the browser's own recogniser | Web Speech API | nothing to download |
| On this device | sounds (phonemes) | a 77 MB model downloaded once, ONNX Runtime Web | free, opt-in |
| Pro | sounds, with a larger model | `scorer/` on the server | one-time payment |

Every level is pinned to the same 0-100 scale with the reference audios in `tests/ref` (native voice,
Spanish-accented voice, a different sentence), so paying never buys a higher score.

## Layout

- `web/` front end: vanilla JS modules bundled by `build.mjs` (esbuild) into `dist/`. No framework.
- `server/` API: Node (no dependencies) + SQLite (`node:sqlite`). Daily clip, results, streaks, stats,
  rankings, Google sign-in, Stripe one-time payment (`lib/billing.mjs`), gateway to the scorer (`lib/pro.mjs`).
- `scorer/` Pro scoring service: Python (numpy + onnxruntime), one job at a time, short queue, audio never
  written to disk. A separate process with its own URL and key, so it can live on another machine.
- `clips/` the queue of prepared clips (`queue/*.json`, order in `queue.json`). One is published per day.
- `tools/` clip preparation (runs on a laptop: transcript, timings, phonemes, native reference, rare words).
- `tests/` end-to-end tests in real Chrome with a fake microphone, sanity checks of the levels, load check.
- `deploy/` service units, deploy script and reverse-proxy example.

The video is always played by the embedded YouTube player; nothing is re-hosted.

## Run it

```
npm install
npm run dev            # builds web/ and starts the API on http://localhost:8821
node tests/e2e.mjs --secret <DC_TEST_AUTH>
```

Configuration comes from the environment or a local `.env` (never committed):

- API: `DC_PORT`, `DC_DATA`, `DC_BASE_URL`, `GOOGLE_CLIENT_ID`, `DC_ADMIN`, `DC_TEST_AUTH` (staging only)
- Pro: `DC_SCORER_URL`, `DC_SCORER_KEY`; billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`
- Scorer: `SCORER_MODEL`, `SCORER_KEY`, `SCORER_PORT`, `SCORER_QUEUE`

Without the Stripe settings there is no Pro card; without the scorer settings Pro falls back to the level
the device has.

## Tests

```
node tests/e2e.mjs   --base <url> --secret <DC_TEST_AUTH>                      # whole flow, phone-sized Chrome
node tests/smoke.mjs --base https://llmers.es                                  # read-only, safe on production
node tests/pro.mjs   --base <staging> --secret <...> --stripe-key sk_test_...  # pay, score, refund (Stripe test mode)
node tests/load.mjs  --base <staging> --results 300 --reads 300 --seconds 60   # never against production
node tests/ref/device.mjs [--throttle 4]                                       # on-device level: sanity + timing
python tests/ref/onnx_check.py MODEL.onnx scorer/vocab.json NAME               # a phoneme model on the reference audios
python tests/ref/calibrate.py NAME                                             # its three points on the common scale
```
