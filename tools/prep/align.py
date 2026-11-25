#!/usr/bin/env python3
"""Forced alignment of a clip's transcript against its audio, with a phoneme CTC model.

Whisper's word timestamps drift by a few hundred ms in fast dialogue, which is too loose to pause a
video right after a sentence. This gives every word the time of its first and last phoneme (20 ms
steps), the canonical phonemes of each word, and the quietest point between consecutive words.

Runs where torch + transformers + phonemizer (espeak-ng) are installed:

    python align.py IN_DIR OUT_DIR          # IN_DIR/<id>/a16.wav + IN_DIR/<id>/text.json

text.json: {"text": "full transcript of the clip", "accent": "us" | "uk"}
OUT_DIR/<id>.json: {"words": [{"w", "t0", "t1", "cut", "ph": [...], "gop": [...]}], "frames": T}
"""
import json
import math
import os
import re
import sys
import time

import numpy as np
import soundfile as sf
import torch
from phonemizer import phonemize
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

MODEL = os.environ.get("DC_ALIGN_MODEL", "facebook/wav2vec2-lv-60-espeak-cv-ft")
SPECIAL = {"<pad>", "<s>", "</s>", "<unk>"}
FRAME = 0.02
NEG = -1e30

torch.set_num_threads(int(os.environ.get("DC_THREADS", "1")))
proc = Wav2Vec2Processor.from_pretrained(MODEL)
model = Wav2Vec2ForCTC.from_pretrained(MODEL).eval()
vocab = proc.tokenizer.get_vocab()
BLANK = vocab["<pad>"]
PHONES = {k: v for k, v in vocab.items() if k not in SPECIAL}
PHONE_IDS = torch.tensor(sorted(PHONES.values()))
ID2PH = {v: k for k, v in vocab.items()}
MAXLEN = max(len(k) for k in PHONES)


def rss_mb():
    for line in open("/proc/self/status"):
        if line.startswith("VmRSS"):
            return int(line.split()[1]) // 1024
    return 0


def to_phones(ipa):
    """espeak IPA string -> model tokens, longest match first (diphthongs are single tokens)."""
    ipa = ipa.replace("ˈ", "").replace("ˌ", "")
    out, i = [], 0
    while i < len(ipa):
        if ipa[i].isspace():
            i += 1
            continue
        for L in range(min(MAXLEN, len(ipa) - i), 0, -1):
            if ipa[i:i + L] in PHONES:
                out.append(ipa[i:i + L])
                i += L
                break
        else:
            i += 1
    return out


def canonical(words, accent="us"):
    """Canonical phonemes of each word, said on its own (espeak-ng)."""
    lang = "en-gb" if accent == "uk" else "en-us"
    clean = [re.sub(r"[^\w']", "", w.replace("’", "'")).lower() or "a" for w in words]
    ipa = phonemize(clean, language=lang, backend="espeak", strip=True, with_stress=False, njobs=1)
    return [to_phones(x) for x in ipa]


def log_probs(wav):
    """Frame log-probabilities for audio of any length, computed in overlapping 16 s windows."""
    CH, OV = 16 * 16000, 2 * 16000
    outs, pos = [], 0
    with torch.no_grad():
        while pos < len(wav):
            a, b = max(0, pos - OV), min(len(wav), pos + CH + OV)
            x = proc(wav[a:b].numpy(), sampling_rate=16000, return_tensors="pt").input_values
            lg = model(x).logits[0]
            f0 = (pos - a) // 320
            f1 = f0 + math.ceil(min(CH, len(wav) - pos) / 320)
            outs.append(lg[f0:f1])
            pos += CH
    return torch.log_softmax(torch.cat(outs), -1)


def viterbi(logp, seq):
    """CTC forced alignment. Returns for every frame the index of the phone it belongs to, or -1 (blank)."""
    T, U = logp.shape[0], len(seq)
    tg = torch.tensor(seq)
    S = 2 * U + 1
    dp = torch.full((S,), NEG)
    dp[0] = logp[0, BLANK]
    dp[1] = logp[0, tg[0]]
    skip_ok = torch.zeros(S, dtype=torch.bool)
    for s in range(3, S, 2):
        if tg[(s - 1) // 2] != tg[(s - 1) // 2 - 1]:
            skip_ok[s] = True
    sym = torch.empty(S, dtype=torch.long)
    sym[0::2] = BLANK
    sym[1::2] = tg
    ptrs = torch.zeros((T, S), dtype=torch.int8)
    neg1, neg2 = torch.full((1,), NEG), torch.full((2,), NEG)
    for t in range(1, T):
        b = torch.cat([neg1, dp[:-1]])
        c = torch.cat([neg2, dp[:-2]])
        c = torch.where(skip_ok, c, torch.full_like(c, NEG))
        best, arg = torch.stack([dp, b, c]).max(0)
        ptrs[t] = arg
        dp = best + logp[t, sym]
    s = S - 1 if dp[S - 1] >= dp[S - 2] else S - 2
    path = [s]
    for t in range(T - 1, 0, -1):
        s = s - int(ptrs[t, s])
        path.append(s)
    path.reverse()
    return [((q - 1) // 2 if q % 2 else -1) for q in path]


def gop_rows(logp, seq, frame_phone, W=2):
    """Per phone: first/last frame and goodness of pronunciation (window of +-W frames, blanks skipped)."""
    T = logp.shape[0]
    best_any = logp[:, PHONE_IDS].max(1).values
    best_id = PHONE_IDS[logp[:, PHONE_IDS].argmax(1)]
    is_blank = logp.argmax(1) == BLANK
    first, last = {}, {}
    for t, q in enumerate(frame_phone):
        if q >= 0:
            first.setdefault(q, t)
            last[q] = t
    rows = []
    for pi in range(len(seq)):
        if pi not in first:
            rows.append(None)
            continue
        t0 = first[pi]
        sel = [t for t in range(max(0, t0 - W), min(T, t0 + W + 1)) if not bool(is_blank[t])] or [t0]
        g = float((logp[sel, seq[pi]] - best_any[sel]).mean())
        heard = ID2PH[int(best_id[sel[int(torch.argmax(best_any[sel]))]])]
        rows.append({"f0": t0, "f1": last[pi], "gop": round(g, 3), "heard": heard})
    return rows


def energy(x, hop=160):
    n = len(x) // hop
    return np.sqrt((x[:n * hop].reshape(n, hop) ** 2).mean(1) + 1e-12)


def quietest(en, a, b):
    i0, i1 = max(0, int(a * 100)), min(len(en) - 3, int(b * 100))
    if i1 <= i0:
        return round((a + b) / 2, 2)
    win = en[i0:i1 + 1] + en[i0 + 1:i1 + 2] + en[i0 + 2:i1 + 3]
    return round((i0 + int(win.argmin()) + 1) / 100.0, 2)


def align(wav_path, text, accent):
    arr, sr = sf.read(wav_path, dtype="float32", always_2d=True)
    assert sr == 16000, "audio must be 16 kHz"
    x = arr.mean(1)
    words = text.split()
    phones = canonical(words, accent)
    seq, owner = [], []
    for wi, ph in enumerate(phones):
        for p in ph:
            seq.append(PHONES[p])
            owner.append(wi)
    logp = log_probs(torch.from_numpy(x))
    rows = gop_rows(logp, seq, viterbi(logp, seq))
    en = energy(x)
    out = []
    for wi, w in enumerate(words):
        mine = [rows[k] for k in range(len(seq)) if owner[k] == wi]
        got = [r for r in mine if r]
        if not got:
            out.append({"w": w, "t0": None, "t1": None, "ph": phones[wi], "gop": []})
            continue
        out.append({"w": w, "t0": round(got[0]["f0"] * FRAME, 2), "t1": round((got[-1]["f1"] + 1) * FRAME, 2),
                    "ph": phones[wi], "gop": [r["gop"] if r else None for r in mine],
                    "heard": [r["heard"] if r else None for r in mine]})
    # words espeak gave no phones for (or the path skipped) borrow their neighbours' times
    for i, o in enumerate(out):
        if o["t0"] is None:
            prev = next((out[j]["t1"] for j in range(i - 1, -1, -1) if out[j]["t1"] is not None), 0.0)
            o["t0"] = o["t1"] = prev
    dur = len(x) / 16000
    for i, o in enumerate(out):
        nxt = out[i + 1]["t0"] if i + 1 < len(out) else min(dur, o["t1"] + 0.8)
        o["cut"] = quietest(en, o["t1"] + 0.03, max(o["t1"] + 0.05, nxt - 0.02)) if nxt - o["t1"] > 0.09 else round(max(o["t1"], (o["t1"] + nxt) / 2), 2)
    return {"words": out, "frames": int(logp.shape[0]), "dur": round(dur, 2)}


def main():
    src, dst = sys.argv[1], sys.argv[2]
    os.makedirs(dst, exist_ok=True)
    print(f"model loaded, rss {rss_mb()} MB", flush=True)
    for vid in sorted(os.listdir(src)):
        d = os.path.join(src, vid)
        out = os.path.join(dst, vid + ".json")
        if not os.path.isdir(d) or os.path.exists(out) or not os.path.exists(os.path.join(d, "text.json")):
            continue
        t0 = time.time()
        try:
            spec = json.load(open(os.path.join(d, "text.json"), encoding="utf-8"))
            res = align(os.path.join(d, "a16.wav"), spec["text"], spec.get("accent", "us"))
            json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False)
            g = [v for w in res["words"] for v in w["gop"] if v is not None]
            print(f"{vid} ok {res['dur']}s audio in {time.time() - t0:.1f}s, {len(res['words'])} words, "
                  f"mean gop {np.mean(g):.2f}, rss {rss_mb()} MB", flush=True)
        except Exception as e:  # keep the batch going
            print(f"{vid} FAILED {type(e).__name__}: {e}", flush=True)
    print("done", flush=True)


if __name__ == "__main__":
    main()
