#!/usr/bin/env python3
"""Synthesises reference audio with edge-tts (free neural voices), in one process.

    python tools/tts.py jobs.json

jobs.json: [{"text": "...", "voice": "en-US-GuyNeural", "out": "path.wav", "rate": 48000, "pad": 0.6}, ...]
A Spanish voice reading English text gives a strong Spanish accent, used as the "accented" reference.
"""
import asyncio
import json
import os
import subprocess
import sys

import edge_tts

NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)


async def one(job):
    out = job["out"]
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    mp3 = out + ".mp3"
    await edge_tts.Communicate(job["text"], job.get("voice", "en-US-GuyNeural")).save(mp3)
    pad = float(job.get("pad", 0.5))
    af = f"adelay={int(pad * 1000)}:all=1,apad=pad_dur={pad}"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", mp3, "-af", af, "-ac", "1", "-ar", str(job.get("rate", 16000)),
                    "-c:a", "pcm_s16le", out], check=True, creationflags=NOWIN)
    os.remove(mp3)
    return out


async def main():
    jobs = json.load(open(sys.argv[1], encoding="utf-8"))
    sem = asyncio.Semaphore(4)

    async def run(j):
        async with sem:
            if os.path.exists(j["out"]) and not j.get("force"):
                return
            for attempt in range(3):
                try:
                    await one(j)
                    return
                except Exception as e:  # network hiccup: retry
                    if attempt == 2:
                        print("FAILED", j["out"], e)
                    await asyncio.sleep(1 + attempt)

    await asyncio.gather(*(run(j) for j in jobs))
    print("done", len(jobs))


asyncio.run(main())
