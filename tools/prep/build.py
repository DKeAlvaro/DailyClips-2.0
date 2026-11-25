#!/usr/bin/env python3
"""Turns aligned words into the clip files the app plays.

    python tools/prep/build.py --review [ID ...]   # print the automatic phrases of each pick, with indices
    python tools/prep/build.py                     # write clips/queue/<slug>.json for every pick that has "lines"

Reads clips/picks.json (the curation: which video, which phrases, title) and work/align-out/<id>.json
(output of align.py). A pick looks like:

    {"yt": "...", "accent": "us", "win": [0, 22],          # rough window, used by pack.py
     "slug": "half-mast", "title": "Half mast is too high", "src": "Parks and Recreation",
     "lines": "0 1+2 ~3 4",        # the clip's lines, by index of the --review listing:
                                   #   a+b joins consecutive phrases, ~ marks context (caption only, not practised)
     "cut": [[4, 6]],              # split automatic phrase 4 after its 6th word (changes the listing)
     "rename": [["100th", "hundredth"]],  # how a word is written on screen (same sound)
     "fix": [["wrong", "right"]]}  # transcript corrections, applied before alignment
"""
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
from fetch import is_sentence_end, split_long  # noqa: E402

PICKS = ROOT / "clips" / "picks.json"
ALIGNED = ROOT / "work" / "align-out"
PACKED = ROOT / "work" / "align-in"
QUEUE = ROOT / "clips" / "queue"


def load_words(vid):
    data = json.loads((ALIGNED / f"{vid}.json").read_text(encoding="utf-8"))
    off = json.loads((PACKED / vid / "text.json").read_text(encoding="utf-8")).get("offset", 0.0)
    words = data["words"]
    for w in words:
        for k in ("t0", "t1", "cut"):
            w[k] = round(w[k] + off, 2)
        w["word"] = w["w"]  # split_long() reads Whisper-style keys
        w["start"], w["end"] = w["t0"], w["t1"]
    return words


def auto_phrases(words, pick):
    """Sentences by punctuation, long ones split at a comma or pause, then the pick's own join/cut."""
    sents, cur = [], []
    for w in words:
        cur.append(w)
        if is_sentence_end(w["w"]):
            sents.append(cur)
            cur = []
    if cur:
        sents.append(cur)
    chunks = []
    for s in sents:
        chunks += split_long(s)
    for i, n in sorted(pick.get("cut", []), reverse=True):
        chunks[i:i + 1] = [chunks[i][:n], chunks[i][n:]]
    return chunks


def parse_lines(spec):
    """ "0 1+2 ~3" -> [([0], False), ([1, 2], False), ([3], True)] """
    out = []
    for tok in str(spec).split():
        skip = tok.startswith("~")
        idx = [int(x) for x in tok.lstrip("~").split("+")]
        assert idx == list(range(idx[0], idx[-1] + 1)), f"not consecutive: {tok}"
        out.append((idx, skip))
    return out


def phrase(chunk, prev_word, next_word):
    first, last = chunk[0], chunk[-1]
    # pause where the audio is quietest after the last word, but never drift far from it
    t1 = min(last["cut"], last["t1"] + 0.45)
    if next_word:
        t1 = min(t1, max(last["t1"] + 0.02, next_word["t0"] - 0.03))
    t0 = max(prev_word["cut"] if prev_word else 0.0, first["t0"] - 0.3)
    gops = [g for w in chunk for g in w.get("gop", []) if g is not None]
    return {
        "t0": round(max(0.0, t0), 2), "t1": round(t1, 2), "text": " ".join(w["w"] for w in chunk),
        "wt": [w["t0"] for w in chunk], "ph": [w["ph"] for w in chunk],
        "_gap": round((next_word["t0"] - last["t1"]) if next_word else 9.0, 2),
        "_wps": round(len(chunk) / max(0.3, last["t1"] - first["t0"]), 1),
        "_gop": round(sum(gops) / len(gops), 1) if gops else 0.0,
    }


def phrases_of(pick, groups=None):
    """Phrases of a pick: the automatic ones, or the given groups of automatic phrases merged."""
    words = load_words(pick["yt"])
    chunks = auto_phrases(words, pick)
    starts, pos = [], 0
    for c in chunks:
        starts.append(pos)
        pos += len(c)
    if groups is None:
        groups = [[i] for i in range(len(chunks))]
    out = []
    for g in groups:
        c = [w for i in g for w in chunks[i]]
        a = starts[g[0]]
        prev_word = words[a - 1] if a else None
        nxt = words[a + len(c)] if a + len(c) < len(words) else None
        out.append(phrase(c, prev_word, nxt))
    return out


def poster(vid, vertical):
    """Vertical videos usually have a vertical thumbnail (oar2); fall back to the classic one."""
    if not vertical:
        return "hqdefault"
    try:
        req = urllib.request.Request(f"https://i.ytimg.com/vi/{vid}/oar2.jpg", method="HEAD")
        with urllib.request.urlopen(req, timeout=8) as r:
            return "oar2" if r.status == 200 else "hqdefault"
    except Exception:
        return "hqdefault"


def written(word, rename):
    """How a word is shown on screen: `rename` maps a word (with or without its punctuation) to its spelling."""
    if word in rename:
        return rename[word]
    bare = word.strip(".,!?;:")
    return word.replace(bare, rename[bare]) if bare and bare in rename else word


def main():
    picks = json.loads(PICKS.read_text(encoding="utf-8"))
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    review = "--review" in sys.argv
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    order = []
    for pick in picks:
        vid = pick["yt"]
        if args and vid not in args:
            continue
        if not (ALIGNED / f"{vid}.json").exists():
            print(f"{vid}: not aligned yet")
            continue
        if review or "lines" not in pick:
            ph = phrases_of(pick)
            meta = json.loads((ROOT / "work" / "clips" / vid / "meta.json").read_text(encoding="utf-8"))
            print(f"\n## {vid} | {meta.get('channel')} | {pick.get('accent')} | {meta.get('duration')}s | {pick.get('title', '')}")
            used = {i: ("~" if sk else "*") for g, sk in parse_lines(pick.get("lines", "")) for i in g}
            for i, p in enumerate(ph):
                flag = used.get(i, " ") + ("!" if p["_gap"] < 0.12 else " ")
                print(f" {flag}{i:2d} {p['t0']:6.2f}-{p['t1']:6.2f} gap {p['_gap']:4.2f} wps {p['_wps']:3.1f} gop {p['_gop']:5.1f}  {p['text']}")
            continue
        spec = parse_lines(pick["lines"])
        ph = phrases_of(pick, [g for g, _ in spec])
        rename = dict(pick.get("rename", []))
        meta = json.loads((ROOT / "work" / "clips" / vid / "meta.json").read_text(encoding="utf-8"))
        ar = round((meta.get("width") or 16) / (meta.get("height") or 9), 4)
        lines = []
        for p, (_, skip) in zip(ph, spec):
            p = {k: v for k, v in p.items() if not k.startswith("_")}
            p["text"] = " ".join(written(w, rename) for w in p["text"].split())
            if skip:
                p = {"t0": p["t0"], "t1": p["t1"], "text": p["text"], "wt": p["wt"], "skip": True}
            lines.append(p)
        while lines and lines[0].get("skip"):  # the first thing on screen is a line to say, never a caption
            lines.pop(0)
        clip = {
            "yt": vid, "title": pick["title"], "src": pick.get("src") or meta.get("channel"), "accent": pick.get("accent", "us"),
            "ar": ar, "poster": poster(vid, ar < 1), "start": round(max(0.0, lines[0]["t0"] - 0.35), 2), "phrases": lines,
        }
        QUEUE.mkdir(parents=True, exist_ok=True)
        (QUEUE / f"{pick['slug']}.json").write_text(json.dumps(clip, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        order.append(pick["slug"])
        n = sum(1 for p in lines if not p.get("skip"))
        lead = lines[0]["t1"] - clip["start"]
        print(f"wrote {pick['slug']}.json  {n} lines, {lines[-1]['t1'] - clip['start']:.0f}s, first turn after {lead:.1f}s" + ("  <-- slow start" if lead > 6 else ""))
    if order and not args and not review:
        (ROOT / "clips" / "queue.json").write_text(json.dumps(order, indent=1) + "\n", encoding="utf-8")
        print(f"queue.json: {len(order)} clips")


if __name__ == "__main__":
    main()
