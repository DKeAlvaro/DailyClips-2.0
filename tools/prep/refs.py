#!/usr/bin/env python3
"""Native reference for every phrase of the queued clips, per phoneme model.

A native voice (TTS) says each phrase; the model scores it against the canonical phonemes. Phonemes
that even the native reference does not hit (reductions, linking, a dictionary form nobody says) are
marked "0" in the phrase's mask and are not counted when a learner is scored. Result, per phrase:

    "m": {"dev": "110111...", "pro": "111101..."}      one character per canonical phoneme

    python tools/prep/refs.py dev=work/models/student_q4.onnx [pro=work/models/lv60_int8.onnx] [slug ...]

Needs onnxruntime, numpy and edge-tts. Audio is cached in work/tts-ref/.
"""
import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scorer"))
from gop import gop_rows, log_softmax, normalize, viterbi  # noqa: E402

QUEUE = ROOT / "clips" / "queue"
TTS = ROOT / "work" / "tts-ref"
VOICE = {"us": "en-US-GuyNeural", "uk": "en-GB-RyanNeural"}
THRESHOLD = -4.0  # a native phone scoring below this is not held against the learner

models = dict(a.split("=", 1) for a in sys.argv[1:] if "=" in a)
only = [a for a in sys.argv[1:] if "=" not in a]
vocab = json.load(open(ROOT / "scorer" / "vocab.json", encoding="utf-8"))

clips = {}
jobs = []
for f in sorted(QUEUE.glob("*.json")):
    if only and f.stem not in only:
        continue
    clip = json.loads(f.read_text(encoding="utf-8"))
    clips[f] = clip
    for i, p in enumerate(clip["phrases"]):
        if p.get("skip") or "ph" not in p:
            continue
        p["_wav"] = TTS / f"{f.stem}-{i}.wav"
        jobs.append({"text": p["text"], "voice": VOICE.get(clip.get("accent", "us"), VOICE["us"]), "out": str(p["_wav"]), "rate": 16000, "pad": 0.4})

TTS.mkdir(parents=True, exist_ok=True)
(TTS / "jobs.json").write_text(json.dumps(jobs), encoding="utf-8")
subprocess.run([sys.executable, str(ROOT / "tools" / "tts.py"), str(TTS / "jobs.json")], check=True)


def read_wav(path):
    with wave.open(str(path), "rb") as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


for name, path in models.items():
    so = ort.SessionOptions()
    so.intra_op_num_threads = 2
    sess = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
    names = [i.name for i in sess.get_inputs()]
    kept = total = 0
    for f, clip in clips.items():
        for p in clip["phrases"]:
            if "_wav" not in p or not p["_wav"].exists():
                continue
            x = normalize(read_wav(p["_wav"]))[None, :]
            feed = {"input_values": x}
            if "attention_mask" in names:
                feed["attention_mask"] = np.ones(x.shape, dtype=np.int64)
            logp = log_softmax(sess.run(None, feed)[0][0].astype(np.float64))
            seq = [vocab[ph] for w in p["ph"] for ph in w]
            rows = gop_rows(logp, seq, viterbi(logp, seq))
            mask = "".join("1" if r["gop"] is not None and r["gop"] >= THRESHOLD else "0" for r in rows)
            if mask.count("1") < max(3, len(mask) // 3):  # reference too far from the dictionary: count everything
                mask = "1" * len(mask)
            p.setdefault("m", {})[name] = mask
            kept += mask.count("1")
            total += len(mask)
    print(f"{name}: {kept}/{total} phonemes counted ({100 * kept // max(1, total)}%)")

for f, clip in clips.items():
    for p in clip["phrases"]:
        p.pop("_wav", None)
    f.write_text(json.dumps(clip, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print("updated", len(clips), "clips")
