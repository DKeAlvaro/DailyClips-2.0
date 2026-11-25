# DailyClips

Practise English pronunciation with one short clip a day. The video stops after every line, you repeat it
into the mic, each word is coloured by how you said it and you get a score. Same clip for everyone, a new
one every day, with streaks, stats, a ranking and a Wordle-style share.

Live at https://llmers.es

## Layout

- `web/` front end: vanilla JS modules bundled by `build.mjs` (esbuild) into `dist/`. No framework.
- `server/` API: Node (no dependencies) + SQLite (`node:sqlite`). Daily clip, results, streaks, stats, rankings, Google sign-in.
- `clips/` the queue of prepared clips (`queue/*.json`, order in `queue.json`). One is published per day.
- `tools/` clip preparation (runs on a laptop: transcript, timings, phonemes) and reference audio.
- `tests/` end-to-end test in real Chrome with a fake microphone.
- `deploy/` service unit and reverse-proxy examples.

The video is always played by the embedded YouTube player; nothing is re-hosted.

## Run it

```
npm install
npm run dev            # builds web/ and starts the API on http://localhost:8821
node tests/e2e.mjs --secret <DC_TEST_AUTH>
```

Configuration comes from the environment or a local `.env` (never committed): `DC_PORT`, `DC_DATA`,
`DC_BASE_URL`, `GOOGLE_CLIENT_ID`, `DC_ADMIN`, `DC_TEST_AUTH` (staging only).
