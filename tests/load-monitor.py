#!/usr/bin/env python3
"""Runs on the server during tests/load.mjs: every second, CPU of the machine, memory of the given
systemd units and how long another service's health URL takes (the one that must not notice).

    python3 tests/load-monitor.py SECONDS URL UNIT [UNIT ...]
"""
import subprocess
import sys
import time
import urllib.request

seconds, url, units = int(sys.argv[1]), sys.argv[2], sys.argv[3:]


def cpu():
    v = [int(x) for x in open("/proc/stat").readline().split()[1:8]]
    return sum(v), v[3] + v[4]


def mem(unit):
    out = subprocess.run(["systemctl", "show", unit, "-p", "MemoryCurrent", "--value"], capture_output=True, text=True).stdout.strip()
    return int(out) // (1 << 20) if out.isdigit() else 0


rows = []
total0, idle0 = cpu()
for _ in range(seconds):
    t = time.time()
    try:
        urllib.request.urlopen(url, timeout=5).read()
        ms = (time.time() - t) * 1000
    except Exception:  # noqa: BLE001
        ms = -1
    time.sleep(max(0, 1 - (time.time() - t)))
    total, idle = cpu()
    busy = 100 * (1 - (idle - idle0) / max(1, total - total0))
    total0, idle0 = total, idle
    avail = int(next(l for l in open("/proc/meminfo") if l.startswith("MemAvailable")).split()[1]) // 1024
    rows.append((busy, ms, avail, [mem(u) for u in units]))
ok = sorted(r[1] for r in rows if r[1] >= 0)
print("samples %d · cpu mean %.0f%% max %.0f%% · %s ms: median %.1f p95 %.1f max %.1f (failed %d)" % (
    len(rows), sum(r[0] for r in rows) / len(rows), max(r[0] for r in rows), url, ok[len(ok) // 2], ok[int(len(ok) * 0.95)], ok[-1], sum(r[1] < 0 for r in rows)))
print("memory available min %d MB · " % min(r[2] for r in rows) + " · ".join("%s max %d MB" % (u, max(r[3][i] for r in rows)) for i, u in enumerate(units)))
