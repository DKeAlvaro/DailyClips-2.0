"""Goodness of pronunciation from the frame posteriors of a phoneme CTC model. numpy only.

The same maths runs in the browser for the on-device level (web/src/gop.js): keep the two in step.

    logp  = log_softmax(logits)              # [T, V], one row per 20 ms frame
    path  = viterbi(logp, phone_ids)         # which canonical phone each frame belongs to (-1 = blank)
    rows  = gop_rows(logp, phone_ids, path)  # per canonical phone: gop <= 0 (0 = exactly what was expected), heard id
"""
import numpy as np

BLANK = 0  # <pad> is the CTC blank in the espeak wav2vec2 models
SPECIAL = (0, 1, 2, 3)  # <pad> <s> </s> <unk>
NEG = -1e30
WINDOW = 2  # frames each side of a phone's first frame


def log_softmax(x):
    x = x - x.max(axis=-1, keepdims=True)
    return x - np.log(np.exp(x).sum(axis=-1, keepdims=True))


def normalize(wav):
    """What Wav2Vec2FeatureExtractor does: zero mean, unit variance."""
    wav = np.asarray(wav, dtype=np.float32)
    return (wav - wav.mean()) / np.sqrt(wav.var() + 1e-7)


def viterbi(logp, seq):
    """CTC forced alignment of the phone ids `seq`. Returns, per frame, the index into seq or -1."""
    T, U = logp.shape[0], len(seq)
    tg = np.asarray(seq)
    S = 2 * U + 1
    if T < U:  # not enough audio to fit every phone
        return [-1] * T
    sym = np.full(S, BLANK, dtype=np.int64)
    sym[1::2] = tg
    skip_ok = np.zeros(S, dtype=bool)
    skip_ok[3::2] = tg[1:] != tg[:-1]
    dp = np.full(S, NEG)
    dp[0] = logp[0, BLANK]
    dp[1] = logp[0, tg[0]]
    ptrs = np.zeros((T, S), dtype=np.int8)
    for t in range(1, T):
        b = np.concatenate(([NEG], dp[:-1]))
        c = np.concatenate(([NEG, NEG], dp[:-2]))
        c = np.where(skip_ok, c, NEG)
        stack = np.stack([dp, b, c])
        arg = stack.argmax(0)
        ptrs[t] = arg
        dp = stack[arg, np.arange(S)] + logp[t, sym]
    s = S - 1 if dp[S - 1] >= dp[S - 2] else S - 2
    path = [s]
    for t in range(T - 1, 0, -1):
        s -= int(ptrs[t, s])
        path.append(s)
    path.reverse()
    return [((q - 1) // 2 if q % 2 else -1) for q in path]


def gop_rows(logp, seq, path):
    """Per canonical phone: {"gop": mean log P(expected) - log P(best phone), "heard": id of the best phone}.

    The models are blank-dominant (about one spike frame per phone), so the average is taken over the
    non-blank frames within WINDOW of the phone's first frame.
    """
    T = logp.shape[0]
    phones = logp.copy()
    phones[:, list(SPECIAL)] = NEG
    best_id = phones.argmax(1)
    best = phones.max(1)
    is_blank = logp.argmax(1) == BLANK
    first = {}
    for t, q in enumerate(path):
        if q >= 0 and q not in first:
            first[q] = t
    rows = []
    for pi, pid in enumerate(seq):
        if pi not in first:
            rows.append({"gop": None, "heard": None})
            continue
        t0 = first[pi]
        sel = [t for t in range(max(0, t0 - WINDOW), min(T, t0 + WINDOW + 1)) if not is_blank[t]] or [t0]
        g = float((logp[sel, pid] - best[sel]).mean())
        top = sel[int(np.argmax(best[sel]))]
        rows.append({"gop": round(g, 3), "heard": int(best_id[top])})
    return rows


def extra_speech(logp, path):
    """Share of the phones the model heard that the alignment could not place on any expected phone.

    Forced alignment only asks "is each expected phone there?", so someone saying a longer, different
    sentence can still land a few lucky phones. Everything they said on top shows up here.
    """
    top = logp.argmax(1)
    phones = logp.copy()
    phones[:, list(SPECIAL)] = NEG
    best_id = phones.argmax(1)
    heard = extra = 0
    prev = None
    for t, q in enumerate(path):
        if top[t] == BLANK:
            prev = None
            continue
        pid = int(best_id[t])
        if pid == prev:
            continue
        prev = pid
        heard += 1
        if q < 0:
            extra += 1
    return extra / heard if heard else 0.0
