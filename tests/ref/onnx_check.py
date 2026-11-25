#!/usr/bin/env python3
"""Runs the reference audios through a phoneme model (ONNX) and reports goodness of pronunciation
per condition: native TTS, Spanish TTS reading the English text, and another phrase.

    python tests/ref/onnx_check.py MODEL.onnx VOCAB.json NAME [--dir work/ref]

Writes <dir>/<NAME>.json: one entry per reference item with the GOP of every canonical phone.
"""
import json
import sys
import time
import wave
from pathlib import Path

import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scorer"))
from gop import extra_speech, gop_rows, log_softmax, normalize, viterbi  # noqa: E402

model_path, vocab_path, name = sys.argv[1], sys.argv[2], sys.argv[3]
ref = Path(sys.argv[sys.argv.index("--dir") + 1]) if "--dir" in sys.argv else ROOT / "work" / "ref"
vocab = json.load(open(vocab_path, encoding="utf-8"))
id2ph = {v: k for k, v in vocab.items()}
index = json.load(open(ref / "index.json", encoding="utf-8"))
phones = json.load(open(ref / "phones.json", encoding="utf-8"))

so = ort.SessionOptions()
so.intra_op_num_threads = 1
so.inter_op_num_threads = 1
t0 = time.time()
sess = ort.InferenceSession(model_path, so, providers=["CPUExecutionProvider"])
print("loaded in %.1fs | inputs %s | outputs %s" % (time.time() - t0, [(i.name, i.type) for i in sess.get_inputs()], [o.name for o in sess.get_outputs()]))
names = [i.name for i in sess.get_inputs()]


def read_wav(path):
    with wave.open(str(path), "rb") as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def run(wav):
    x = normalize(wav)[None, :]
    feed = {"input_values": x}
    if "attention_mask" in names:
        feed["attention_mask"] = np.ones(x.shape, dtype=np.int64)
    return log_softmax(sess.run(None, feed)[0][0].astype(np.float64))


out, secs, audio = [], 0.0, 0.0
for item in index:
    wav = read_wav(ref / item["file"])
    words = phones[item["phrase"]]
    seq = [vocab[p] for w in words for p in w]
    t = time.time()
    logp = run(wav)
    path = viterbi(logp, seq)
    rows = gop_rows(logp, seq, path)
    extra = extra_speech(logp, path)
    secs += time.time() - t
    audio += len(wav) / 16000
    g = [r["gop"] for r in rows if r["gop"] is not None]
    out.append({**item, "gop": [r["gop"] for r in rows], "heard": [id2ph.get(r["heard"]) for r in rows],
                "extra": round(extra, 3), "mean": round(float(np.mean(g)), 3), "exact": round(float(np.mean([x > -0.01 for x in g])), 3)})
json.dump(out, open(ref / f"{name}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print("%.1fs of audio scored in %.1fs (x%.2f realtime, 1 thread)" % (audio, secs, secs / audio))
for cond in ("native", "spanish", "other"):
    m = [o["mean"] for o in out if o["cond"] == cond]
    e = [o["exact"] for o in out if o["cond"] == cond]
    print("%-8s mean GOP %6.2f (min %6.2f max %6.2f)   phones matched exactly %3.0f%%" % (cond, np.mean(m), min(m), max(m), 100 * np.mean(e)))
ok = 0
n = max(o["phrase"] for o in out) + 1
for i in range(n):
    c = {k: np.mean([o["mean"] for o in out if o["phrase"] == i and o["cond"] == k]) for k in ("native", "spanish", "other")}
    good = c["native"] > c["spanish"] > c["other"]
    ok += good
    print("  phrase %d: native %6.2f  spanish %6.2f  other %6.2f  %s" % (i, c["native"], c["spanish"], c["other"], "ok" if good else "ORDER BROKEN"))
print("order native > spanish > other holds in %d/%d phrases" % (ok, n))
