#!/usr/bin/env python3
"""Pro scoring service: phoneme-level goodness of pronunciation with a large phoneme model.

A small HTTP service of its own (stdlib + numpy + onnxruntime), so it can move to another machine:
the API only knows its URL and a shared secret.

    POST /score?ph=12,45,33      body: 16 kHz mono PCM16 (little endian), at most SCORER_MAX_SECONDS
        header X-Scorer-Key: <SCORER_KEY>
        -> {"rows": [{"gop": -1.2, "heard": "ɪ"}, ...], "extra": 0.04, "ms": 812, "seconds": 3.1}
        -> 503 {"error": "busy"} when the queue is full: it never takes on more work than it can finish
    GET /health -> {"ok": true, "running": 0, "waiting": 0, "done": 12, "rejected": 3, "rss_mb": 512}

One job runs at a time and a few may wait; everything else is refused straight away. The audio only
ever lives in memory and is dropped as soon as the score is out.

Environment: SCORER_MODEL (path to the .onnx), SCORER_KEY, SCORER_PORT (8830), SCORER_HOST (127.0.0.1),
SCORER_QUEUE (jobs allowed to wait, 3), SCORER_MAX_SECONDS (15), SCORER_THREADS (1).
"""
import hmac
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
import onnxruntime as ort

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from gop import extra_speech, gop_rows, log_softmax, normalize, viterbi  # noqa: E402

MODEL = os.environ.get("SCORER_MODEL", "")
KEY = os.environ.get("SCORER_KEY", "")
PORT = int(os.environ.get("SCORER_PORT", "8830"))
HOST = os.environ.get("SCORER_HOST", "127.0.0.1")
QUEUE = int(os.environ.get("SCORER_QUEUE", "3"))
MAX_SECONDS = float(os.environ.get("SCORER_MAX_SECONDS", "15"))
THREADS = int(os.environ.get("SCORER_THREADS", "1"))
RATE = 16000
MAX_BYTES = int(MAX_SECONDS * RATE * 2)
MAX_PHONES = 200

VOCAB = json.load(open(HERE / "vocab.json", encoding="utf-8"))
ID2PH = {v: k for k, v in VOCAB.items()}

if hasattr(ort, "disable_telemetry_events"):
    ort.disable_telemetry_events()
so = ort.SessionOptions()
so.intra_op_num_threads = THREADS
so.inter_op_num_threads = 1
t0 = time.time()
session = ort.InferenceSession(MODEL, so, providers=["CPUExecutionProvider"])
INPUTS = [i.name for i in session.get_inputs()]

slots = threading.Lock()  # guards the counters
model = threading.Lock()  # one inference at a time
state = {"running": 0, "waiting": 0, "done": 0, "rejected": 0}


def rss_mb():
    try:
        for line in open("/proc/self/status"):
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) // 1024
    except OSError:
        pass
    return None


def score(pcm16, seq):
    wav = np.frombuffer(pcm16, dtype="<i2").astype(np.float32) / 32768.0
    x = normalize(wav)[None, :]
    feed = {"input_values": x}
    if "attention_mask" in INPUTS:
        feed["attention_mask"] = np.ones(x.shape, dtype=np.int64)
    logp = log_softmax(session.run(None, feed)[0][0].astype(np.float64))
    path = viterbi(logp, seq)
    rows = [{"gop": r["gop"], "heard": ID2PH.get(r["heard"])} for r in gop_rows(logp, seq, path)]
    return rows, round(extra_speech(logp, path), 3), len(wav) / RATE


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    timeout = 20

    def reply(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        if status >= 400:
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if urlparse(self.path).path != "/health":
            return self.reply(404, {"error": "not_found"})
        with slots:
            body = dict(state)
        self.reply(200, {"ok": True, **body, "queue": QUEUE, "rss_mb": rss_mb()})

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/score":
            return self.reply(404, {"error": "not_found"})
        if not KEY or not hmac.compare_digest(self.headers.get("X-Scorer-Key", ""), KEY):
            return self.reply(403, {"error": "forbidden"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            seq = [int(v) for v in parse_qs(url.query).get("ph", [""])[0].split(",")]
        except ValueError:
            return self.reply(400, {"error": "bad_request"})
        if not seq or len(seq) > MAX_PHONES or any(v < 4 or v not in ID2PH for v in seq):
            return self.reply(400, {"error": "bad_phones"})
        if size < RATE // 5 * 2 or size % 2:
            return self.reply(400, {"error": "bad_audio"})
        if size > MAX_BYTES:
            return self.reply(413, {"error": "too_long"})
        # take a place in the queue before reading the audio: a full queue costs nothing
        with slots:
            if state["running"] + state["waiting"] >= 1 + QUEUE:
                state["rejected"] += 1
                full = True
            else:
                state["waiting"] += 1
                full = False
        if full:
            return self.reply(503, {"error": "busy"})
        running = False
        try:
            pcm = self.rfile.read(size)
            if len(pcm) != size:
                return self.reply(400, {"error": "bad_audio"})
            queued = time.time()
            with model:
                with slots:
                    state["waiting"] -= 1
                    state["running"] += 1
                    running = True
                started = time.time()
                rows, extra, seconds = score(pcm, seq)
                del pcm
            ms = int((time.time() - started) * 1000)
            self.reply(200, {"rows": rows, "extra": extra, "ms": ms, "wait_ms": int((started - queued) * 1000), "seconds": round(seconds, 2)})
        except Exception as e:  # noqa: BLE001  a bad take must never take the service down
            print("score failed:", repr(e), flush=True)
            try:
                self.reply(500, {"error": "scorer_error"})
            except OSError:
                pass
        finally:
            with slots:
                if running:
                    state["running"] -= 1
                    state["done"] += 1
                else:
                    state["waiting"] -= 1

    def log_message(self, *args):
        pass


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64


if __name__ == "__main__":
    print("model %s loaded in %.1fs, rss %s MB, %d thread(s), queue %d, listening on %s:%d"
          % (Path(MODEL).name, time.time() - t0, rss_mb(), THREADS, QUEUE, HOST, PORT), flush=True)
    Server((HOST, PORT), Handler).serve_forever()
