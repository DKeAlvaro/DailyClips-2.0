#!/usr/bin/env python3
"""Builds the inputs for align.py from clips already fetched with fetch.py.

    python tools/prep/pack.py clips/picks.json work/align-in [ID ...]

For every pick it cuts the audio to the rough window (plus margin, at sentence boundaries of the
Whisper transcript) and writes <out>/<id>/a16.wav and text.json {text, accent, offset}.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
sys.path.insert(0, str(Path(__file__).parent))
from fetch import is_sentence_end  # noqa: E402

picks = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
out = Path(sys.argv[2])
only = set(sys.argv[3:])

for pick in picks:
    vid, accent = pick["yt"], pick.get("accent", "us")
    a, b = pick["win"]
    if only and vid not in only:
        continue
    d = ROOT / "work" / "clips" / vid
    asr = json.loads((d / "asr.json").read_text(encoding="utf-8"))
    words = [w for w in asr["words"] if w["word"].strip()]
    # sentence starts/ends by punctuation
    starts = [0] + [i + 1 for i, w in enumerate(words[:-1]) if is_sentence_end(w["word"])]
    first = max([i for i in starts if words[i]["start"] <= max(0.0, a - 2.5)] or [0])
    ends = [i for i, w in enumerate(words) if is_sentence_end(w["word"])] + [len(words) - 1]
    last = min([i for i in ends if words[i]["end"] >= b + 2.0] or [len(words) - 1])
    t0 = max(0.0, words[first]["start"] - 0.7) if first else 0.0
    t1 = words[last]["end"] + 0.9
    text = " ".join(w["word"].strip() for w in words[first:last + 1])
    for wrong, right in pick.get("fix", []):
        if wrong not in text:
            print(f"  {vid}: fix not found: {wrong!r}")
        text = text.replace(wrong, right)
    o = out / vid
    o.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t0:.2f}", "-to", f"{t1:.2f}", "-i", str(d / "a16.wav"),
                    "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(o / "a16.wav")], check=True, creationflags=NOWIN)
    (o / "text.json").write_text(json.dumps({"text": text, "accent": accent, "offset": round(t0, 2), "win": [a, b]}, ensure_ascii=False), encoding="utf-8")
    print(f"{vid} {t1 - t0:5.1f}s  {len(text.split()):3d} words  offset {t0:.2f}")
