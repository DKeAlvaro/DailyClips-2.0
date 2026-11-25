#!/usr/bin/env python3
"""Reference audio for calibrating and sanity-checking the scoring levels.

For every phrase in phrases.json: two native voices, two Spanish voices reading the English text
(a strong Spanish accent), all through edge-tts. "Another phrase" is simply the native audio of the
next phrase scored against this one.

    python tests/ref/make.py      # writes work/ref/<i>-<voice>.wav (16 kHz mono) + work/ref/index.json
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "work" / "ref"
VOICES = {"native-m": "en-US-GuyNeural", "native-f": "en-US-JennyNeural", "spanish-m": "es-ES-AlvaroNeural", "spanish-f": "es-ES-ElviraNeural"}
phrases = json.loads((Path(__file__).parent / "phrases.json").read_text(encoding="utf-8"))
jobs, index = [], []
for i, text in enumerate(phrases):
    for tag, voice in VOICES.items():
        f = OUT / f"{i}-{tag}.wav"
        jobs.append({"text": text, "voice": voice, "out": str(f), "rate": 16000, "pad": 0.6})
        index.append({"phrase": i, "text": text, "cond": tag.split("-")[0], "voice": tag, "file": f.name})
    index.append({"phrase": i, "text": text, "cond": "other", "voice": "native-m", "file": f"{(i + 1) % len(phrases)}-native-m.wav"})
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "jobs.json").write_text(json.dumps(jobs), encoding="utf-8")
(OUT / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")
subprocess.run([sys.executable, str(ROOT / "tools" / "tts.py"), str(OUT / "jobs.json")], check=True)
print(len(index), "reference items")
