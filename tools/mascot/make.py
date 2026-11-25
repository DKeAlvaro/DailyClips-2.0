"""DailyClips mascot: raster set made with the Revana image API, keyed and exported as web cut-outs.

Run from the repo root. Every command returns in < 30 s (submit, then poll with separate calls).
  python tools/mascot/make.py bal                          balance (the first call stores the starting balance)
  python tools/mascot/make.py quote base [--model M --n N]  price only, nothing created
  python tools/mascot/make.py submit base [--model M --n N] [--variant b] [--ref FILE] [--extra "..."]
  python tools/mascot/make.py poll                          one look at pending jobs; downloads what finished
  python tools/mascot/make.py pick MOOD FILE                chosen raw image for a mood (work/mascot/picks.json)
  python tools/mascot/make.py export                        key magenta, align to the base, write 320px WebP
  python tools/mascot/make.py sheet                         contact sheet -> work/look/mascot-raster.png

Reference chain (what made mascot1, all nano-banana-pro 1K, $0.04/image):
  base --variant a --n 2 (copper bob; variant b = dark curls lost its silhouette on the dark UI)
  -> refine --ref <best base> --n 2 (bolder outline, lime headband)  -> picked refine = `idle`
  -> happy / wow / almost / oops / listen / talk, each `submit MOOD --ref <idle file>`; hands are kept close to the
     face (HANDS) because the crop is shared and a far-out hand shrinks her in every mood.
`talk` is made from `idle` and only its mouth region (work/mascot/mouth.json, base pixels) is pasted back onto idle,
so the two swap without a jump. Then `pick` each mood, `export`, `sheet`.
Raw generations, jobs.jsonl, picks.json and spend.md live in work/mascot/ (gitignored). Budget guard: BUDGET USD
total over all jobs (finished cost + pending estimate), max 2 generations in flight (Revana holds ~3x per job).
Key: REVANA_API_KEY from the environment or the vault .env (never printed).
"""
import argparse, json, os, sys, time, mimetypes, urllib.request, urllib.error

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
WORK = os.path.join(ROOT, "work", "mascot")
RAW = os.path.join(WORK, "raw")
JOBS = os.path.join(WORK, "jobs.jsonl")
PICKS = os.path.join(WORK, "picks.json")
OUT = os.path.join(ROOT, "web", "static", "assets", "mascot1")
SHEET = os.path.join(ROOT, "work", "look", "mascot-raster.png")
API = "https://api.revana.si/v1"
ENV = os.environ.get("VAULT_ENV", "C:/Users/Alvaro/Desktop/3-proyectos/pocket-vault-2/.env")
BUDGET = 0.95
MOOD_LIST = ["idle", "happy", "wow", "almost", "oops", "listen", "talk"]

STYLE = ("Clean flat 2D vector mascot illustration for a modern mobile app brand. Bold, confident, uniform dark "
         "outline (#12160A) around every shape, flat colour fills with at most one soft cel-shade tone, simple "
         "geometric shapes, a limited palette of about seven colours, large clear facial features that still read "
         "as a tiny icon. Not anime, not chibi, not childish, not sexualised, not 3D, no realistic rendering, no "
         "texture, no gradients, no glow, no sparkles.")
BG = ("Background: perfectly flat, uniform pure magenta #FF00FF filling the whole canvas, no shadow, no floor, no "
      "vignette, no gradient, no other objects, no text, no logo, no watermark. Square image. The character is "
      "centred with generous empty margin above her head and on both sides; the bust is cut off cleanly by the "
      "bottom edge of the image at mid-chest.")
CHAR = {
    "a": ("A friendly, slightly cheeky young woman in her early twenties, the voice of an English pronunciation "
          "app. Head-and-shoulders bust, facing the viewer straight on, upright and symmetrical, looking right at "
          "the viewer. Her signature item: big chunky over-ear headphones in bright lime green (#B9F33F) with dark "
          "charcoal ear cushions and a dark headband, worn over her hair, both ear cups clearly visible at the "
          "sides of her head. Short, chunky, rounded copper-auburn bob with blunt bangs, one bold hair shape. "
          "Warm medium-tan skin, dark brown eyes, small subtle nose. Plain off-white crew-neck t-shirt with no "
          "print. Expression: relaxed, confident small closed-mouth smile."),
    "b": ("A friendly, slightly cheeky young woman in her early twenties, the voice of an English pronunciation "
          "app. Head-and-shoulders bust, facing the viewer straight on, upright and symmetrical, looking right at "
          "the viewer. Her signature item: big chunky over-ear headphones in bright lime green (#B9F33F) with dark "
          "charcoal ear cushions and a dark headband, worn over her hair, both ear cups clearly visible at the "
          "sides of her head. Big voluminous dark-brown curly hair forming one bold rounded cloud shape down to "
          "her shoulders, with short curly bangs. Warm brown skin, dark eyes, small subtle nose. Plain off-white "
          "crew-neck t-shirt with no print. Expression: relaxed, confident small closed-mouth smile."),
}
KEEP = ("Edit this image. Keep the exact same character, same face shape, same hair, same lime headphones, same "
        "t-shirt, same art style and outline weight, same framing, same size and same position in the frame, same "
        "flat magenta #FF00FF background. Her head stays upright and centred exactly where it is. Only the facial "
        "expression and the gesture change: ")
# hands far out widen the shared crop and shrink her head in every mood, so they stay close to the face
HANDS = (" Any visible hand is drawn simply with exactly five fingers and stays close to her face, never further "
         "out than the outer edge of her hair, fully inside the frame.")
MOODS = {
    "happy": ("a big happy open-mouthed smile showing her upper teeth, eyes squeezed into happy upward crescents, "
              "eyebrows up, joyful because the user did well. No hands."),
    "wow": ("delighted and amazed: eyes very wide and round with big white highlights, eyebrows high, mouth wide "
            "open in an amazed grin, both hands balled into small excited fists held up just below her chin, a "
            "delighted 'yes!' celebration of a perfect score." + HANDS),
    "almost": ("an encouraging, playful 'so close!' face: a cheeky wink, a lopsided teeth-showing grin, one hand "
               "raised in front of her chest just below her chin, making the 'just a tiny bit' gesture: thumb and "
               "index finger almost touching, the small gap between them clearly visible against her t-shirt, "
               "the other fingers curled." + HANDS),
    "oops": ("a warm, playful 'oops, tricky one!' face, sympathetic and never sad or judging: looking straight at "
             "the viewer, both eyebrows raised and tilted up in the middle, a wide 'eek' grin with clenched teeth "
             "showing, shoulders raised in a small shrug. No hands, arms down out of view."),
    "listen": ("attentive listening: eyebrows slightly raised, eyes looking at the viewer with interest, a small "
               "closed-mouth smile, one hand cupped over the outside of her lime headphone ear cup as if "
               "listening closely, fingers resting on the ear cup." + HANDS),
    "talk": ("exactly the same small smile and eyes as now, but the mouth is open mid-word, talking cheerfully, "
             "a simple open mouth showing a little of the upper teeth. Nothing else changes, no hands."),
}


REFINE = ("Redraw this exact character as a polished, deliberate brand mascot. Same copper-auburn bob with blunt "
          "bangs, same lime green headphones, same off-white t-shirt, same pose, same framing and size. Make it "
          "bolder and simpler: one thick uniform near-black outline around every shape, flat colours, only one "
          "hard-edged shadow tone on the hair and skin, no soft gradients, no blush. A clean simplified face: large "
          "dark expressive eyes with one small white highlight each, simple bold eyebrows, the nose a small simple "
          "shape, a confident, slightly cheeky closed-mouth smile with one corner a little higher. Headphones: big "
          "chunky rounded lime green (#B9F33F) ear cups with dark charcoal cushions and a lime headband clearly "
          "arching over the top of her hair. The bob is symmetrical and ends at the jaw on both sides. ")


def prompt_for(mood, variant="a", extra=""):
    if mood == "base":
        p = f"{CHAR[variant]} {STYLE} {BG}"
    elif mood == "refine":
        p = REFINE + BG
    else:
        p = KEEP + MOODS[mood] + " " + BG
    return (p + " " + extra).strip()


# ---------- Revana ----------
def key():
    k = os.environ.get("REVANA_API_KEY")
    if not k and os.path.exists(ENV):
        for line in open(ENV, encoding="utf-8"):
            if line.startswith("REVANA_API_KEY="):
                k = line.split("=", 1)[1].strip()
    return k or sys.exit("no REVANA_API_KEY")


def call(method, path, body=None, timeout=25):
    req = urllib.request.Request(API + path, method=method,
                                 headers={"Authorization": "Bearer " + key(), "Content-Type": "application/json"})
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode(errors='ignore')[:600]}")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def download(path):
    """/content redirects to a presigned URL that must be fetched WITHOUT the bearer header."""
    req = urllib.request.Request(API + path, headers={"Authorization": "Bearer " + key()})
    try:
        with urllib.request.build_opener(_NoRedirect).open(req, timeout=20) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code not in (301, 302, 303, 307, 308):
            sys.exit(f"HTTP {e.code}")
        loc = e.headers["Location"]
    with urllib.request.urlopen(loc, timeout=20) as r:
        return r.read()


def upload(path):
    data = open(path, "rb").read()
    r = call("POST", "/uploads", {"content_type": mimetypes.guess_type(path)[0] or "image/png",
                                  "bytes": len(data), "filename": os.path.basename(path)})
    req = urllib.request.Request(r["upload_url"], data=data, method="PUT", headers=r.get("upload_headers") or {})
    with urllib.request.urlopen(req, timeout=25) as resp:
        resp.read()
    return r["url"]


# ---------- job book-keeping ----------
def jobs():
    if not os.path.exists(JOBS):
        return []
    return [json.loads(l) for l in open(JOBS, encoding="utf-8") if l.strip()]


def save_jobs(js):
    os.makedirs(WORK, exist_ok=True)
    with open(JOBS, "w", encoding="utf-8") as f:
        for j in js:
            f.write(json.dumps(j, ensure_ascii=False) + "\n")


def committed(js):
    return sum((j.get("cost_usd") or 0) if j["status"] in ("succeeded", "failed") else j["est"] for j in js)


def write_spend(js, bal=None):
    start = json.load(open(os.path.join(WORK, "balance-start.json")))
    rows = ["# Mascot spend (Revana)", "",
            f"Start: available ${start['available_usd']:.2f}, account spent_usd {start['spent_usd']:.2f} "
            f"({start['ts']}). Budget ${BUDGET:.2f}.", "",
            "| # | mood | model | n | status | cost USD | files |", "|---|---|---|---|---|---|---|"]
    for i, j in enumerate(js, 1):
        c = j.get("cost_usd")
        rows.append(f"| {i} | {j['mood']}{'/' + j['variant'] if j['mood'] == 'base' else ''} | {j['model']} | "
                    f"{j['n']} | {j['status']} | {c if c is not None else '~%.2f' % j['est']} | "
                    f"{' '.join(os.path.basename(f) for f in j.get('files', []))} |")
    done = sum(j.get("cost_usd") or 0 for j in js if j["status"] in ("succeeded", "failed"))
    rows += ["", f"Billed so far: ${done:.3f} (incl. pending estimate: ${committed(js):.3f})"]
    if bal:
        rows.append(f"Balance now: available ${bal['available_usd']:.2f}, held ${bal['held_usd']:.2f}, "
                    f"account spent_usd {bal['spent_usd']:.2f} -> delta ${bal['spent_usd'] - start['spent_usd']:.2f}")
    open(os.path.join(WORK, "spend.md"), "w", encoding="utf-8").write("\n".join(rows) + "\n")


def body_for(a, ref_url=None):
    inp = {"prompt": prompt_for(a.mood, a.variant, a.extra), "aspect_ratio": "1:1", "resolution": "1K"}
    if a.n > 1:
        inp["num_images"] = a.n
    if ref_url:
        inp["image_urls"] = [ref_url]
    return {"model": a.model, "input": inp}


def cmd_bal(a):
    b = call("GET", "/balance")
    os.makedirs(WORK, exist_ok=True)
    sp = os.path.join(WORK, "balance-start.json")
    if not os.path.exists(sp):
        json.dump({**b, "ts": time.strftime("%Y-%m-%d %H:%M")}, open(sp, "w"))
    print(f"available ${b['available_usd']} held ${b['held_usd']} spent_usd {b['spent_usd']}")
    write_spend(jobs(), b)


def cmd_quote(a):
    print(json.dumps(call("POST", "/generations/quote", body_for(a, upload(a.ref) if a.ref else None))))


def cmd_submit(a):
    js = jobs()
    if sum(j["status"] not in ("succeeded", "failed") for j in js) >= 2:
        sys.exit("2 generations already in flight: poll first")
    ref_url = upload(a.ref) if a.ref else None            # uploads are free; the quote needs a real URL
    body = body_for(a, ref_url)
    q = call("POST", "/generations/quote", body)
    est = float(q.get("quoted_usd") or 0.05 * a.n)
    if committed(js) + est > BUDGET:
        sys.exit(f"budget: committed ${committed(js):.3f} + ${est:.3f} > ${BUDGET}")
    body["max_cost_usd"] = round(est * 1.05 + 0.001, 3)
    r = call("POST", "/generations", body)
    js.append({"id": r["id"], "mood": a.mood, "variant": a.variant, "model": a.model, "n": a.n,
               "ref": os.path.relpath(a.ref, ROOT) if a.ref else None, "prompt": body["input"]["prompt"],
               "est": est, "status": r.get("status", "queued"), "ts": time.strftime("%H:%M:%S")})
    save_jobs(js)
    write_spend(js)
    print("submitted", r["id"], a.mood, a.model, f"est ${est}")


def cmd_poll(a):
    js = jobs()
    t0 = time.time()
    while a.wait and time.time() - t0 < a.wait:              # bounded (< 25 s): look again until something is done
        pend = [j for j in js if j["status"] not in ("succeeded", "failed")]
        if not pend or any(call("GET", f"/generations/{j['id']}", timeout=8).get("status") in ("succeeded", "failed")
                           for j in pend):
            break
        time.sleep(4)
    t0 = time.time()
    for j in js:
        if j["status"] in ("succeeded", "failed") or time.time() - t0 > 18:
            continue
        g = call("GET", f"/generations/{j['id']}", timeout=10)
        j["status"] = g.get("status", j["status"])
        if j["status"] in ("succeeded", "failed"):
            j["cost_usd"] = g.get("cost_usd") or 0
        if j["status"] == "failed":
            j["error"] = str(g.get("error"))[:300]
        if j["status"] == "succeeded":
            os.makedirs(RAW, exist_ok=True)
            j["files"] = []
            for i, _ in enumerate((g.get("output") or {}).get("urls") or [], 1):
                b = download(f"/generations/{j['id']}/content" + ("" if i == 1 else f"/{i}"))
                ext = ".png" if b[:4] == b"\x89PNG" else ".webp" if b[8:12] == b"WEBP" else ".jpg"
                tag = j["mood"] + ("-" + j["variant"] if j["mood"] == "base" else "")
                f = os.path.join(RAW, f"{tag}-{j['id'][-6:]}-{i}{ext}")
                open(f, "wb").write(b)
                j["files"].append(os.path.relpath(f, ROOT).replace("\\", "/"))
        print(j["mood"], j["model"], j["status"], j.get("cost_usd"), " ".join(j.get("files", [])), j.get("error", ""))
    save_jobs(js)
    write_spend(js, call("GET", "/balance"))


def cmd_pick(a):
    p = json.load(open(PICKS)) if os.path.exists(PICKS) else {}
    p[a.mood] = os.path.relpath(a.file, ROOT).replace("\\", "/")
    json.dump(p, open(PICKS, "w"), indent=1)
    print(p)


# ---------- keying, alignment, export ----------
def key_magenta(path):
    """RGBA float arrays from a magenta-screen image: alpha from 'magenta-ness' min(R,B)-G, colour unmixed."""
    import numpy as np
    from PIL import Image
    im = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    h, w, _ = im.shape
    border = np.concatenate([im[:8].reshape(-1, 3), im[-8:, :8].reshape(-1, 3), im[:, :8].reshape(-1, 3),
                             im[:, -8:].reshape(-1, 3)])
    K = np.median(border, 0)                                   # actual key colour (close to #FF00FF)
    m = np.minimum(im[..., 0], im[..., 2]) - im[..., 1]
    mk = min(K[0], K[2]) - K[1]
    t = np.clip((m - 0.12 * mk) / (0.80 * mk), 0, 1)           # 0 = foreground, 1 = key
    alpha = 1 - t
    import cv2
    # holes: only keep foreground islands that are big (removes specks); fill tiny holes inside the character
    solid = (alpha > 0.5).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(solid, 8)
    keep = np.zeros(n, bool)
    keep[1:] = st[1:, cv2.CC_STAT_AREA] > 0.002 * h * w
    big = keep[lab]
    near = cv2.dilate(big.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    alpha = np.where(near, alpha, 0)
    a3 = np.maximum(alpha, 1e-3)[..., None]
    fg = np.clip((im - (1 - alpha[..., None]) * K) / a3, 0, 255)   # unmix the key colour (good where alpha is high)
    edge = cv2.dilate((alpha < 0.98).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    spill = np.clip(np.minimum(fg[..., 0], fg[..., 2]) - fg[..., 1], 0, None) * edge
    fg[..., 0] -= spill
    fg[..., 2] -= spill
    # thin edge band: unmixing amplifies JPEG noise at low alpha (light rim on dark backgrounds), so take the
    # colour of the nearest solid pixels instead (normalized convolution); the outer edge is the dark outline
    solid = (alpha >= 0.9).astype(np.float32)
    num = cv2.blur(fg * solid[..., None], (9, 9))
    den = cv2.blur(solid, (9, 9))[..., None]
    band = (alpha < 0.9) & (alpha > 0) & (den[..., 0] > 0)
    fg[band] = (num / np.maximum(den, 1e-6))[band]
    return np.clip(fg, 0, 255), np.clip(alpha, 0, 1)


def similarity(src_rgb, dst_rgb):
    """2x3 similarity transform mapping src onto dst (ORB + RANSAC on the parts that did not change)."""
    import cv2, numpy as np
    g1 = cv2.cvtColor(src_rgb.astype(np.uint8), cv2.COLOR_RGB2GRAY)
    g2 = cv2.cvtColor(dst_rgb.astype(np.uint8), cv2.COLOR_RGB2GRAY)
    orb = cv2.ORB_create(4000)
    k1, d1 = orb.detectAndCompute(g1, None)
    k2, d2 = orb.detectAndCompute(g2, None)
    ms = sorted(cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(d1, d2), key=lambda m: m.distance)[:600]
    p1 = np.float32([k1[m.queryIdx].pt for m in ms])
    p2 = np.float32([k2[m.trainIdx].pt for m in ms])
    M, inl = cv2.estimateAffinePartial2D(p1, p2, method=cv2.RANSAC, ransacReprojThreshold=3)
    return M, int(inl.sum()) if inl is not None else 0


def cmd_export(a):
    import cv2, numpy as np
    from PIL import Image
    picks = json.load(open(PICKS))
    base_fg, base_a = key_magenta(os.path.join(ROOT, picks["idle"]))
    h, w = base_a.shape
    layers = {}
    for mood in MOOD_LIST:
        if mood not in picks:
            continue
        fg, al = (base_fg, base_a) if mood == "idle" else key_magenta(os.path.join(ROOT, picks[mood]))
        if mood != "idle":
            M, inl = similarity(fg * al[..., None], base_fg * base_a[..., None])
            s = float(np.hypot(M[0, 0], M[1, 0]))
            print(f"{mood}: scale {s:.4f} rot {np.degrees(np.arctan2(M[1, 0], M[0, 0])):.2f} "
                  f"shift {M[0, 2]:.1f},{M[1, 2]:.1f} inliers {inl}")
        if mood != "idle" and (abs(s - 1) > 0.002 or abs(M[0, 2]) > 0.5 or abs(M[1, 2]) > 0.5):
            pm = np.dstack([fg * al[..., None], al * 255])  # only resample when the edit really moved her
            pm = cv2.warpAffine(pm, M, (w, h), flags=cv2.INTER_CUBIC, borderValue=0)
            al = np.clip(pm[..., 3] / 255, 0, 1)
            fg = np.clip(pm[..., :3] / np.maximum(al, 1e-3)[..., None], 0, 255)
        layers[mood] = [fg, al]
    if "talk" in layers:                                       # mouth only, pasted onto idle
        box = json.load(open(os.path.join(WORK, "mouth.json")))  # {"x0","y0","x1","y1"} in base pixels
        msk = np.zeros((h, w), np.float32)
        cx, cy = (box["x0"] + box["x1"]) / 2, (box["y0"] + box["y1"]) / 2
        cv2.ellipse(msk, (int(cx), int(cy)), (int((box["x1"] - box["x0"]) / 2), int((box["y1"] - box["y0"]) / 2)),
                    0, 0, 360, 1, -1)
        msk = cv2.GaussianBlur(msk, (0, 0), 6)[..., None]
        tf, ta = layers["talk"]
        layers["talk"] = [base_fg * (1 - msk) + tf * msk, base_a * (1 - msk[..., 0]) + ta * msk[..., 0]]
    # one crop for all: a square as wide as the union of the alphas (shoulders, hands), hung from the top of the
    # highest mood with a small margin; the square's bottom edge cuts the bust at the chest
    union = np.zeros((h, w), bool)
    for _, al in layers.values():
        union |= al > 0.05
    top = np.where(union.any(1))[0][0]
    rows = h
    for _ in range(3):                                         # arms below the cut line must not widen the square
        xs = np.where(union[:rows].any(0))[0]
        side = int((xs.max() - xs.min()) * a.pad)
        cx = (xs.min() + xs.max()) // 2
        x0, y0 = int(cx - side // 2), int(top - 0.025 * side)
        rows = min(h, y0 + side)
    print(f"crop x{x0} y{y0} side {side}")
    os.makedirs(OUT, exist_ok=True)
    for mood, (fg, al) in layers.items():
        rgba = np.dstack([fg, al * 255]).astype(np.float32)
        pad = np.zeros((side, side, 4), np.float32)
        sx0, sy0, sx1, sy1 = max(x0, 0), max(y0, 0), min(x0 + side, w), min(y0 + side, h)
        pad[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = rgba[sy0:sy1, sx0:sx1]
        pm = pad.copy()
        pm[..., :3] *= pm[..., 3:4] / 255                     # resize premultiplied (no dark/magenta halos)
        pm = cv2.resize(pm, (320, 320), interpolation=cv2.INTER_AREA)
        a8 = np.clip(pm[..., 3], 0, 255)
        rgb = np.clip(pm[..., :3] / np.maximum(a8, 1e-3)[..., None] * 255, 0, 255)
        img = Image.fromarray(np.dstack([rgb, a8]).astype(np.uint8), "RGBA")
        q = a.quality
        f = os.path.join(OUT, f"{mood}.webp")
        img.save(f, "WEBP", quality=q, alpha_quality=80, method=6)
        while os.path.getsize(f) > 25000 and q > 50:
            q -= 5
            img.save(f, "WEBP", quality=q, alpha_quality=80, method=6)
        print(f"{mood}.webp {os.path.getsize(f)} B q{q}")


def cmd_sheet(a):
    from PIL import Image, ImageDraw, ImageFont
    moods = [m for m in MOOD_LIST if os.path.exists(os.path.join(OUT, m + ".webp"))]
    sizes = [40, 72, 160]
    cw = 190
    W, H = 120 + cw * len(moods), 60 + 3 * 190 + 200
    sheet = Image.new("RGB", (W, H), "#0b0c0a")
    d = ImageDraw.Draw(sheet)
    font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 16) if os.name == "nt" else ImageFont.load_default()
    d.rectangle([0, 60 + 3 * 190, W, H], fill="#ffffff")
    for i, m in enumerate(moods):
        x = 120 + i * cw
        d.text((x + 10, 20), m, fill="#b9f33f", font=font)
        src = Image.open(os.path.join(OUT, m + ".webp"))
        for r, s in enumerate(sizes):
            y = 60 + r * 190
            if i == 0:
                d.text((20, y + 70), f"{s} px", fill="#a9a99c", font=font)
            d.rounded_rectangle([x, y, x + 176, y + 176], 14, fill="#171813")
            im = src.resize((s, s), Image.LANCZOS)
            sheet.paste(im, (x + (176 - s) // 2, y + (176 - s) // 2), im)
        im = src.resize((160, 160), Image.LANCZOS)
        sheet.paste(im, (x + 8, 60 + 3 * 190 + 20), im)
    d.text((20, 60 + 3 * 190 + 90), "white", fill="#555555", font=font)
    os.makedirs(os.path.dirname(SHEET), exist_ok=True)
    sheet.save(SHEET)
    print(SHEET)


def main():
    p = argparse.ArgumentParser()
    s = p.add_subparsers(dest="cmd", required=True)
    s.add_parser("bal"); s.add_parser("sheet")
    s.add_parser("poll").add_argument("--wait", type=int, default=0, choices=range(0, 21))
    for name in ("quote", "submit"):
        q = s.add_parser(name)
        q.add_argument("mood", choices=["base", "refine"] + list(MOODS))
        q.add_argument("--model", default="nano-banana-2")
        q.add_argument("--n", type=int, default=1)
        q.add_argument("--variant", default="a", choices=list(CHAR))
        q.add_argument("--ref")
        q.add_argument("--extra", default="")
    k = s.add_parser("pick"); k.add_argument("mood", choices=MOOD_LIST); k.add_argument("file")
    e = s.add_parser("export"); e.add_argument("--quality", type=int, default=82)
    e.add_argument("--pad", type=float, default=1.04)
    a = p.parse_args()
    {"bal": cmd_bal, "quote": cmd_quote, "submit": cmd_submit, "poll": cmd_poll, "pick": cmd_pick,
     "export": cmd_export, "sheet": cmd_sheet}[a.cmd](a)


if __name__ == "__main__":
    main()
