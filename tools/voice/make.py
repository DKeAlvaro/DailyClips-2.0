"""Generate the mascot voice bank with ElevenLabs.

Usage (run from the repo root):
  ELEVENLABS_API_KEY=... python tools/voice/make.py [--only take_perfect | --only take_perfect-3] [--force]
  python tools/voice/make.py --test      # two probe lines only (raw, not written to the bank)

Reads tools/voice/lines.json, writes raw downloads to work/voice-raw/ and processed
mono 64 kbps / 44.1 kHz MP3s (trimmed, loudness-normalised) to web/static/assets/voice1/.
Existing outputs are skipped unless --force. The API key comes from ELEVENLABS_API_KEY.
Env MODEL overrides the model (default eleven_v3).
"""
import argparse, json, os, subprocess, sys, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RAW = os.path.join(ROOT, "work", "voice-raw")
OUT = os.path.join(ROOT, "web", "static", "assets", "voice1")
MODEL = os.environ.get("MODEL", "eleven_v3")
SETTINGS = {
    "eleven_v3": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.35, "use_speaker_boost": True},
    "eleven_multilingual_v2": {"stability": 0.4, "similarity_boost": 0.8, "style": 0.35, "use_speaker_boost": True},
}

def tts(key, voice, text):
    body = json.dumps({"text": text, "model_id": MODEL, "voice_settings": SETTINGS[MODEL]}).encode()
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
        data=body, headers={"xi-api-key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read()[:300]!r}")

FILT = ("silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,"
        "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse")

def ff(args):
    return subprocess.run(["ffmpeg", "-hide_banner", "-nostats", *args], capture_output=True, text=True)

def process(raw, out):
    # trim, then measure and apply loudnorm linearly (two-step), fall back to peak norm
    trimmed = raw + ".trim.wav"
    ff(["-y", "-i", raw, "-af", FILT, "-ac", "1", "-ar", "44100", trimmed])
    tgt = "I=-16:TP=-1.5:LRA=11"
    r = ff(["-i", trimmed, "-af", f"loudnorm={tgt}:print_format=json", "-f", "null", "-"])
    af = None
    try:
        j = json.loads(r.stderr[r.stderr.rindex("{"):r.stderr.rindex("}") + 1])
        af = (f"loudnorm={tgt}:measured_I={j['input_i']}:measured_TP={j['input_tp']}:"
              f"measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:"
              f"offset={j['target_offset']}:linear=true,alimiter=limit=0.84:level=false")
    except Exception:
        af = "dynaudnorm=f=50:g=5,alimiter=limit=0.84"
    ff(["-y", "-i", trimmed, "-af", af, "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "64k", out])
    os.remove(trimmed)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only"); ap.add_argument("--force", action="store_true")
    ap.add_argument("--test", action="store_true")
    a = ap.parse_args()
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key: sys.exit("ELEVENLABS_API_KEY not set")
    data = json.load(open(os.path.join(ROOT, "tools", "voice", "lines.json"), encoding="utf-8"))
    voice = data["voice_id"]
    os.makedirs(RAW, exist_ok=True); os.makedirs(OUT, exist_ok=True)
    if a.test:
        for i, t in enumerate(["Nailed it!", "Hmm, almost there!"]):
            p = os.path.join(RAW, f"test-{i}.mp3")
            open(p, "wb").write(tts(key, voice, t)); print("ok", t, os.path.getsize(p))
        return
    jobs = []
    for m, texts in data["lines"].items():
        for n, t in enumerate(texts, 1):
            name = f"{m}-{n}"
            if a.only and a.only not in (m, name): continue
            out = os.path.join(OUT, name + ".mp3")
            if os.path.exists(out) and not a.force: continue
            jobs.append((name, t, out))
    print(len(jobs), "to do", flush=True)
    def run(j):
        name, t, out = j
        raw = os.path.join(RAW, name + ".mp3")
        try:
            if not os.path.exists(raw) or a.force:
                open(raw, "wb").write(tts(key, voice, t))
            process(raw, out); return f"ok {name}"
        except Exception as e:
            return f"FAIL {name}: {e}"
    with ThreadPoolExecutor(3) as ex:
        for r in ex.map(run, jobs): print(r, flush=True)

if __name__ == "__main__":
    main()
