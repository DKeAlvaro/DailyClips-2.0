#!/usr/bin/env python3
"""Fetch a YouTube video's metadata + audio, transcribe it with word timestamps and
cut the transcript into practice phrases.

Runs wherever yt-dlp can reach YouTube (a laptop or a phone; datacenter IPs are usually blocked).
The audio is only used locally to compute timings; nothing is re-hosted. The app plays the
video through the embedded YouTube player.

    python tools/prep/fetch.py ID [ID ...]            # full pipeline for each id
    python tools/prep/fetch.py --file ids.txt
    python tools/prep/fetch.py --list URL --top 30    # list ids of a channel tab / search
    python tools/prep/fetch.py --range 62-95 ID       # only that section of a long video

Output per id in work/clips/<id>/: meta.json, audio.m4a, a16.wav, asr.json, draft.json, summary.txt
Needs GROQ_API_KEY in the environment or in ./.env
"""
import argparse
import json
import os
import re
import struct
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "work" / "clips"
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)  # no console popups on Windows

ABBREV = {"mr.", "mrs.", "ms.", "dr.", "st.", "vs.", "jr.", "sr.", "prof.", "mt.", "no.", "u.s.", "a.m.", "p.m."}


def env(name):
    if os.environ.get(name):
        return os.environ[name]
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(f"{name} missing (environment or .env)")


def run(cmd, timeout=120):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                          timeout=timeout, creationflags=NOWIN)


def list_ids(url, top):
    r = run(["yt-dlp", "--flat-playlist", "--playlist-end", str(top), "--print",
             "%(id)s\t%(view_count)s\t%(duration)s\t%(title)s", url])
    for line in r.stdout.splitlines():
        print(line)
    if r.returncode != 0:
        print(r.stderr[-400:], file=sys.stderr)


def fetch_meta(vid, d):
    f = d / "meta.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    r = run(["yt-dlp", "-J", "--no-warnings", f"https://www.youtube.com/watch?v={vid}"])
    if r.returncode != 0:
        raise RuntimeError("meta: " + r.stderr.strip()[-200:])
    j = json.loads(r.stdout)
    keep = ["id", "title", "channel", "channel_id", "uploader_id", "duration", "width", "height",
            "playable_in_embed", "age_limit", "availability", "view_count", "like_count", "language",
            "upload_date", "categories", "live_status"]
    meta = {k: j.get(k) for k in keep}
    f.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    return meta


def fetch_audio(vid, d, rng=None):
    m4a, wav = d / "audio.m4a", d / "a16.wav"
    if not m4a.exists():
        cmd = ["yt-dlp", "-q", "--no-warnings", "-f", "bestaudio[ext=m4a]/bestaudio", "-o", str(d / "audio.%(ext)s")]
        if rng:
            cmd += ["--download-sections", f"*{rng[0]}-{rng[1]}", "--force-keyframes-at-cuts"]
        r = run(cmd + [f"https://www.youtube.com/watch?v={vid}"], timeout=180)
        got = [p for p in d.glob("audio.*")]
        if not got:
            raise RuntimeError("audio: " + r.stderr.strip()[-200:])
        if got[0] != m4a:  # webm/opus fallback -> remux name only, ffmpeg reads either
            m4a = got[0]
    else:
        m4a = next(d.glob("audio.*"))
    if not wav.exists():
        r = run(["ffmpeg", "-v", "error", "-y", "-i", str(m4a), "-ac", "1", "-ar", "16000", str(wav)])
        if r.returncode != 0:
            raise RuntimeError("ffmpeg: " + r.stderr.strip()[-200:])
    return m4a, wav


def transcribe(m4a, d):
    f = d / "asr.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    r = run(["curl", "-s", "-m", "90", "https://api.groq.com/openai/v1/audio/transcriptions",
             "-H", "Authorization: Bearer " + env("GROQ_API_KEY"),
             "-F", f"file=@{m4a}", "-F", "model=whisper-large-v3", "-F", "response_format=verbose_json",
             "-F", "language=en", "-F", "timestamp_granularities[]=word",
             "-F", "timestamp_granularities[]=segment"], timeout=120)
    j = json.loads(r.stdout)
    if "words" not in j:
        raise RuntimeError("asr: " + r.stdout[:200])
    f.write_text(json.dumps(j, ensure_ascii=False), encoding="utf-8")
    return j


def read_wav(path):
    with wave.open(str(path), "rb") as w:
        n = w.getnframes()
        raw = w.readframes(n)
    return struct.unpack("<%dh" % (len(raw) // 2), raw)


def energy(samples, hop=160):
    """RMS per 10 ms frame."""
    out = []
    for i in range(0, len(samples) - hop, hop):
        s = 0
        for v in samples[i:i + hop]:
            s += v * v
        out.append((s / hop) ** 0.5)
    return out


def quietest(en, a, b):
    """Time (s) of the quietest 30 ms inside [a, b]."""
    i0, i1 = max(0, int(a * 100)), min(len(en) - 3, int(b * 100))
    if i1 <= i0:
        return max(0.0, a)
    best, bi = None, i0
    for i in range(i0, i1 + 1):
        v = en[i] + en[i + 1] + en[i + 2]
        if best is None or v < best:
            best, bi = v, i
    return (bi + 1) / 100.0


def is_sentence_end(tok):
    t = tok.strip()
    if not t or t[-1] not in ".?!":
        return False
    low = t.lower()
    if low in ABBREV:
        return False
    if re.fullmatch(r"[A-Za-z]\.", t):  # initials: "M."
        return False
    return True


def split_long(words, max_words=11):
    """Split one sentence (list of word dicts) into chunks of <= max_words at the best comma/pause."""
    if len(words) <= max_words:
        return [words]
    best, bi = None, None
    for i in range(3, len(words) - 3):
        gap = words[i + 1]["start"] - words[i]["end"]
        comma = words[i]["word"].rstrip()[-1:] in ",;:—-"
        score = (2.0 if comma else 0.0) + min(gap, 0.6) * 4 - abs(i + 1 - len(words) / 2) / len(words) * 2
        if best is None or score > best:
            best, bi = score, i
    if bi is None:
        bi = len(words) // 2 - 1
    return split_long(words[:bi + 1], max_words) + split_long(words[bi + 1:], max_words)


def segment(asr, en):
    words = [w for w in asr["words"] if w["word"].strip()]
    sents, cur = [], []
    for w in words:
        cur.append(w)
        if is_sentence_end(w["word"]):
            sents.append(cur)
            cur = []
    if cur:
        sents.append(cur)
    chunks = []
    for s in sents:
        chunks += split_long(s)
    # merge 1-2 word fragments into a neighbour of the same breath when the result stays short
    merged = []
    for c in chunks:
        if merged and len(c) <= 2 and len(merged[-1]) + len(c) <= 9 and c[0]["start"] - merged[-1][-1]["end"] < 0.3 \
                and not is_sentence_end(merged[-1][-1]["word"]):
            merged[-1] = merged[-1] + c
        else:
            merged.append(c)
    phrases = []
    for i, c in enumerate(merged):
        t0, t1 = c[0]["start"], c[-1]["end"]
        nxt = merged[i + 1][0]["start"] if i + 1 < len(merged) else t1 + 0.6
        prv = merged[i - 1][-1]["end"] if i else max(0.0, t0 - 0.4)
        end = quietest(en, t1 - 0.04, min(nxt + 0.02, t1 + 0.45)) if en else t1
        start = quietest(en, max(prv - 0.02, t0 - 0.3), t0 + 0.04) if en else t0
        text = " ".join(w["word"].strip() for w in c)
        phrases.append({"t0": round(start, 2), "t1": round(max(end, t1), 2), "text": text,
                        "n": len(c), "wps": round(len(c) / max(0.2, t1 - t0), 2),
                        "gap": round(nxt - t1, 2)})
    return phrases


def summarize(meta, asr, phrases):
    segs = asr.get("segments", [])
    lp = sum(s.get("avg_logprob", 0) for s in segs) / max(1, len(segs))
    nsp = max([s.get("no_speech_prob", 0) for s in segs] or [0])
    dur = meta.get("duration") or (asr["words"][-1]["end"] if asr.get("words") else 0)
    ar = (meta.get("width") or 16) / (meta.get("height") or 9)
    lines = [f"{meta['id']} | {meta.get('channel')} | {meta.get('title')}",
             f"dur {dur}s  {'vertical' if ar < 1 else 'horizontal'} {meta.get('width')}x{meta.get('height')}  "
             f"embed={meta.get('playable_in_embed')} age={meta.get('age_limit')} views={meta.get('view_count')}  "
             f"words={len(asr.get('words', []))} avg_logprob={lp:.2f} max_nospeech={nsp:.2f}"]
    for i, p in enumerate(phrases):
        lines.append(f"  {i:2d}  {p['t0']:6.2f}-{p['t1']:6.2f}  n={p['n']:2d} wps={p['wps']:.1f} gap={p['gap']:.2f}  {p['text']}")
    return "\n".join(lines)


def process(vid, rng=None, force=False):
    d = WORK / vid
    d.mkdir(parents=True, exist_ok=True)
    if (d / "summary.txt").exists() and not force:
        return (d / "summary.txt").read_text(encoding="utf-8")
    meta = fetch_meta(vid, d)
    if meta.get("playable_in_embed") is False:
        raise RuntimeError("not embeddable")
    if (meta.get("age_limit") or 0) > 0:
        raise RuntimeError("age restricted")
    if not rng and (meta.get("duration") or 0) > 240:
        raise RuntimeError(f"too long ({meta.get('duration')}s): pass --range a-b")
    m4a, wav = fetch_audio(vid, d, rng)
    asr = transcribe(m4a, d)
    off = float(rng[0]) if rng else 0.0
    en = energy(read_wav(wav))
    phrases = segment(asr, en)
    for p in phrases:
        p["t0"] = round(p["t0"] + off, 2)
        p["t1"] = round(p["t1"] + off, 2)
    draft = {"yt": vid, "title": meta.get("title"), "channel": meta.get("channel"),
             "ar": round((meta.get("width") or 16) / (meta.get("height") or 9), 4),
             "duration": meta.get("duration"), "offset": off, "phrases": phrases}
    (d / "draft.json").write_text(json.dumps(draft, ensure_ascii=False, indent=1), encoding="utf-8")
    s = summarize(meta, asr, phrases)
    (d / "summary.txt").write_text(s, encoding="utf-8")
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--file")
    ap.add_argument("--list")
    ap.add_argument("--top", type=int, default=30)
    ap.add_argument("--range")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if a.list:
        return list_ids(a.list, a.top)
    ids = list(a.ids)
    if a.file:
        ids += [l.split()[0] for l in Path(a.file).read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")]
    rng = a.range.split("-") if a.range else None
    for vid in ids:
        try:
            print(process(vid, rng, a.force), flush=True)
        except Exception as e:  # keep the batch going
            print(f"{vid} | SKIP: {e}", flush=True)
        print(flush=True)


if __name__ == "__main__":
    main()
