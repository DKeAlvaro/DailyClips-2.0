// On-device level: a phoneme model that is downloaded once (never on its own) and runs in the browser
// with ONNX Runtime Web. The audio never leaves the phone.
import { record } from './rec.js';
import { logSoftmax, viterbi, gopRows, extraSpeech } from './gop.js';
import { scorePhrase } from './phon.js';
import VOCAB from './vocab.json';

export const MODEL_MB = 77;
const MODEL_URL = 'https://huggingface.co/air-air/xlsr-53-espeak-student-ONNX/resolve/main/onnx/model_q4.onnx';
const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';
const CACHE = 'dailyclips-model-v1';
const ID2PH = Object.fromEntries(Object.entries(VOCAB).map(([k, v]) => [v, k]));

export async function modelCached() {
  try {
    return !!(await (await caches.open(CACHE)).match(MODEL_URL));
  } catch {
    return false;
  }
}

/** Downloads the model into the browser's cache. onProgress gets 0..1. */
export async function downloadModel(onProgress) {
  const cache = await caches.open(CACHE);
  if (await cache.match(MODEL_URL)) return;
  const r = await fetch(MODEL_URL);
  if (!r.ok || !r.body) throw new Error('download_failed');
  const total = Number(r.headers.get('content-length')) || MODEL_MB * 1e6;
  const reader = r.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (onProgress) onProgress(Math.min(1, got / total));
  }
  const blob = new Blob(parts, { type: 'application/octet-stream' });
  await cache.put(MODEL_URL, new Response(blob, { headers: { 'Content-Length': String(blob.size) } }));
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

export async function removeModel() {
  if (worker) worker.terminate();
  worker = null;
  ready = null;
  await caches.delete(CACHE);
}

// The model runs in a worker so the page keeps animating while it thinks. The worker is built from
// the source of these two functions: they must not use anything defined outside of themselves.
function engine() {
  let ort, session;
  return async (m) => {
    if (m.type === 'init') {
      ort = await import(m.ort + 'ort.wasm.min.mjs');
      ort.env.wasm.wasmPaths = m.ort;
      ort.env.wasm.numThreads = 1; // threads need cross-origin isolation, which rules out the YouTube embed
      session = await ort.InferenceSession.create(m.model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      return { ok: true };
    }
    const n = m.pcm.length;
    const feeds = { input_values: new ort.Tensor('float32', m.pcm, [1, n]) };
    if (session.inputNames.includes('attention_mask')) feeds.attention_mask = new ort.Tensor('int64', new BigInt64Array(n).fill(1n), [1, n]);
    const out = await session.run(feeds);
    const logits = out[session.outputNames[0]];
    return { ok: true, data: new Float32Array(logits.data), dims: logits.dims };
  };
}

function workerMain(makeEngine) {
  const run = makeEngine();
  self.onmessage = async (e) => {
    try {
      const out = await run(e.data);
      self.postMessage({ id: e.data.id, ...out }, out.data ? [out.data.buffer] : []);
    } catch (err) {
      self.postMessage({ id: e.data.id, ok: false, error: String((err && err.message) || err) });
    }
  };
}

let worker = null, ready = null, seq = 0, inline = null;
const waiting = new Map();

/** Measurement only: run the model on the page's own thread (so CPU throttling applies to it). */
export function useMainThread() {
  inline = engine();
}

function call(msg, transfer = []) {
  if (inline) return inline(msg);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer);
  });
}

/** Starts the worker and loads the model from the cache. Safe to call early to warm up. */
export function loadModel() {
  if (!ready) {
    ready = (async () => {
      const hit = await (await caches.open(CACHE)).match(MODEL_URL);
      if (!hit) throw new Error('no_model');
      const model = await hit.arrayBuffer();
      if (!inline) {
        const src = URL.createObjectURL(new Blob([`(${workerMain.toString()})(${engine.toString()})`], { type: 'text/javascript' }));
        worker = new Worker(src, { type: 'module' });
        worker.onmessage = (e) => {
          const w = waiting.get(e.data.id);
          if (!w) return;
          waiting.delete(e.data.id);
          if (e.data.ok) w.resolve(e.data);
          else w.reject(new Error(e.data.error));
        };
        worker.onerror = (e) => {
          for (const w of waiting.values()) w.reject(new Error(e.message || 'worker'));
          waiting.clear();
        };
      }
      await call({ type: 'init', ort: ORT_URL, model }, inline ? [] : [model]);
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

/** Frame log-probabilities for 16 kHz mono audio. */
async function posteriors(pcm) {
  await loadModel();
  let mean = 0;
  for (let i = 0; i < pcm.length; i++) mean += pcm[i];
  mean /= pcm.length;
  let v = 0;
  for (let i = 0; i < pcm.length; i++) v += (pcm[i] - mean) * (pcm[i] - mean);
  const std = Math.sqrt(v / pcm.length + 1e-7);
  const x = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) x[i] = (pcm[i] - mean) / std;
  const out = await call({ type: 'run', pcm: x }, [x.buffer]);
  const [, T, V] = out.dims;
  return { logp: logSoftmax(out.data, T, V), T, V };
}

/** Scores 16 kHz audio of someone saying `unit` (a phrase of a clip with its canonical phones). */
export async function scoreAudio(unit, pcm) {
  const t0 = performance.now();
  const { logp, T, V } = await posteriors(pcm);
  const ids = unit.ph.flat().map((p) => VOCAB[p]);
  const path = viterbi(logp, T, V, ids);
  const rows = gopRows(logp, T, V, ids, path).map((r) => ({ gop: r.gop, heard: r.heard == null ? null : ID2PH[r.heard] }));
  const extra = extraSpeech(logp, T, V, path);
  return { ...scorePhrase(unit, rows, 'dev', extra), rows, extra, ms: Math.round(performance.now() - t0) };
}

export function listenDevice(unit, { maxMs, onLevel, onScoring } = {}) {
  const rec = record({ maxMs, onLevel });
  const promise = (async () => {
    const r = await rec.promise;
    if (!r.ok) return r;
    if (onScoring) onScoring();
    try {
      return { ok: true, ...(await scoreAudio(unit, r.pcm)), seconds: r.seconds };
    } catch (e) {
      return { ok: false, why: 'model', error: e.message };
    }
  })();
  return { promise, stop: rec.stop };
}
