#!/usr/bin/env python3
"""Canonical phonemes of English words with espeak-ng, tokenised to the phoneme model's vocabulary.

    echo '["Hello, this is Michael Scott."]' | python g2p.py vocab.json [us|uk]
    -> [[["h","əl","oʊ"], ["ð","ɪ","s"], ...]]      one list of phonemes per word, per sentence

Needs phonemizer + espeak-ng. No model is loaded: this is cheap.
"""
import json
import re
import sys

from phonemizer import phonemize

SPECIAL = {"<pad>", "<s>", "</s>", "<unk>"}


def load_vocab(path):
    vocab = json.load(open(path, encoding="utf-8"))
    return {k: v for k, v in vocab.items() if k not in SPECIAL}


def to_phones(ipa, phones, maxlen):
    """espeak IPA string -> model tokens, longest match first (diphthongs are single tokens)."""
    ipa = ipa.replace("ˈ", "").replace("ˌ", "")
    out, i = [], 0
    while i < len(ipa):
        if ipa[i].isspace():
            i += 1
            continue
        for L in range(min(maxlen, len(ipa) - i), 0, -1):
            if ipa[i:i + L] in phones:
                out.append(ipa[i:i + L])
                i += L
                break
        else:
            i += 1
    return out


def canonical(words, phones, accent="us"):
    """Each word said on its own (citation form)."""
    lang = "en-gb" if accent == "uk" else "en-us"
    clean = [re.sub(r"[^\w']", "", w.replace("\u2019", "'")).lower() or "a" for w in words]
    ipa = phonemize(clean, language=lang, backend="espeak", strip=True, with_stress=False, njobs=1)
    maxlen = max(len(k) for k in phones)
    return [to_phones(x, phones, maxlen) for x in ipa]


if __name__ == "__main__":
    phones = load_vocab(sys.argv[1])
    accent = sys.argv[2] if len(sys.argv) > 2 else "us"
    sentences = json.load(sys.stdin)
    json.dump([canonical(s.split(), phones, accent) for s in sentences], sys.stdout, ensure_ascii=False)
