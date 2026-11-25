#!/usr/bin/env python3
"""Marks the words of every queued clip that speech recognisers cannot be trusted with.

Brands, made-up words and unusual names ("jazzercise", "Schrute") are replaced by common words by a
recogniser even when they are said well, so the web level must not hold them against the speaker.
A word is "rare" when its frequency in English (wordfreq, Zipf scale) is under 3.0, roughly less than
once per million words. Each phrase gets the indices of its rare words (words split on spaces):

    "rare": [1]

    python tools/prep/rare.py [slug ...]      # needs: pip install wordfreq

The phoneme levels ignore this: they score the sounds themselves.
"""
import json
import re
import sys
from pathlib import Path

from wordfreq import zipf_frequency

QUEUE = Path(__file__).resolve().parents[2] / "clips" / "queue"
LIMIT = 3.0


def is_rare(word):
    for part in re.split(r"[-–—/]+", word.replace("’", "'")):
        bare = re.sub(r"[^a-z']", "", part.lower()).strip("'")
        if len(bare) < 4 or re.search(r"\d", part):
            continue
        base = re.sub(r"'(s|d|ll|re|ve|m)$", "", bare)  # Dwight's -> dwight
        if max(zipf_frequency(bare, "en"), zipf_frequency(bare.replace("'", ""), "en"), zipf_frequency(base, "en")) < LIMIT:
            return True
    return False


only = sys.argv[1:]
found = {}
for f in sorted(QUEUE.glob("*.json")):
    if only and f.stem not in only:
        continue
    clip = json.loads(f.read_text(encoding="utf-8"))
    for p in clip["phrases"]:
        idx = [i for i, w in enumerate(p["text"].split()) if is_rare(w)]
        if idx:
            p["rare"] = idx
            for i in idx:
                found.setdefault(p["text"].split()[i].strip(".,!?\"'").lower(), f.stem)
        else:
            p.pop("rare", None)
    f.write_text(json.dumps(clip, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(len(found), "rare words:", ", ".join(sorted(found)))
