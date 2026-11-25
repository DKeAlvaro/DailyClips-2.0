#!/usr/bin/env python3
"""Calibration points of a phoneme model on the common scale, from the reference audios.

    python tests/ref/calibrate.py NAME [K]        # reads work/ref/NAME.json written by onnx_check.py

The common scale is the web level's. On the same audios the web level gives native speech 100,
Spanish-accented speech 77 and a different sentence 8, so the model's raw phrase score for those
three conditions is pinned to 100 / 77 / 8 (the `pts` of CAL in web/src/phon.js).

Raw phrase score = mean over the counted phones of clamp(1 + gop / K), times (1 - extra speech).
Counted phones = those the native reference voice (native-m) gets at gop >= -4, as refs.py does per clip.
"""
import json
import statistics as st
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
name = sys.argv[1]
K = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
WEB = {"other": 8, "spanish": 77, "native": 100}
d = json.load(open(ROOT / "work" / "ref" / f"{name}.json", encoding="utf-8"))
n = max(x["phrase"] for x in d) + 1


def get(i, voice, cond):
    return next(x for x in d if x["phrase"] == i and x["voice"] == voice and x["cond"] == cond)


def raw(item, mask):
    v = [max(0.0, min(1.0, 1 + (g if g is not None else -99) / K)) for g, m in zip(item["gop"], mask) if m]
    return (sum(v) / len(v)) * (1 - item.get("extra", 0.0))


rows = {"native": [], "spanish": [], "other": []}
ok = 0
for i in range(n):
    ref = get(i, "native-m", "native")["gop"]
    mask = [g is not None and g >= -4 for g in ref]
    if sum(mask) < max(3, len(mask) // 3):
        mask = [True] * len(mask)
    nat = raw(get(i, "native-f", "native"), mask)
    spa = st.mean([raw(get(i, "spanish-m", "spanish"), mask), raw(get(i, "spanish-f", "spanish"), mask)])
    oth = raw(get(i, "native-m", "other"), mask)
    rows["native"].append(nat)
    rows["spanish"].append(spa)
    rows["other"].append(oth)
    ok += nat > spa > oth
    print(f"phrase {i}: native {nat:.2f}  spanish {spa:.2f}  other {oth:.2f}  {'ok' if nat > spa > oth else 'ORDER BROKEN'}")
m = {k: st.mean(v) for k, v in rows.items()}
print(f"\nK={K:g}  raw means: native {m['native']:.3f}  spanish {m['spanish']:.3f}  other {m['other']:.3f}   order holds in {ok}/{n}")
print("pts: [[%.2f, %d], [%.2f, %d], [%.2f, %d]]" % (m["other"], WEB["other"], m["spanish"], WEB["spanish"], m["native"], WEB["native"]))
