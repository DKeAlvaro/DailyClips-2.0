#!/usr/bin/env python3
"""Creates (or reuses) what Pro needs in a Stripe account and writes the three settings into an env file:
the "DailyClips Pro" product, its one-time price and the webhook endpoint of this instance.

    STRIPE_KEY=sk_... python3 deploy/stripe-setup.py <env file> <base url> [amount in cents, default 499]

Works the same with a test key (staging) and a live key (production). Other products, prices and
webhook endpoints of the account are left alone. Older prices of the product are archived.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

key, env_file, base = os.environ["STRIPE_KEY"], sys.argv[1], sys.argv[2].rstrip("/")
amount = int(sys.argv[3]) if len(sys.argv) > 3 else 499
EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "charge.refunded", "charge.dispute.created"]


def call(method, path, params=None):
    data = urllib.parse.urlencode(params, doseq=True).encode() if params else None
    req = urllib.request.Request("https://api.stripe.com/v1" + path, data=data, method=method, headers={"Authorization": "Bearer " + key})
    try:
        return json.load(urllib.request.urlopen(req, timeout=20))
    except urllib.error.HTTPError as e:
        sys.exit("stripe %s %s -> %s %s" % (method, path, e.code, e.read().decode()[:300]))


prod = next((p for p in call("GET", "/products?active=true&limit=100")["data"] if p["name"] == "DailyClips Pro"), None)
if not prod:
    prod = call("POST", "/products", {"name": "DailyClips Pro", "metadata[app]": "dailyclips"})
call("POST", "/products/" + prod["id"], {"description": "Sound-by-sound pronunciation scoring on the server. One-time payment."})
price = None
for p in call("GET", "/prices?active=true&limit=100&product=" + prod["id"])["data"]:
    if p["unit_amount"] == amount and p["currency"] == "eur" and not p.get("recurring") and not price:
        price = p
    else:
        call("POST", "/prices/" + p["id"], {"active": "false"})
if not price:
    price = call("POST", "/prices", {"product": prod["id"], "unit_amount": amount, "currency": "eur", "nickname": "DailyClips Pro, one-time"})
url = base + "/api/billing/webhook"
for h in call("GET", "/webhook_endpoints?limit=100")["data"]:
    if h["url"] == url:
        call("DELETE", "/webhook_endpoints/" + h["id"])  # the signing secret is only shown on creation
hook = call("POST", "/webhook_endpoints", {"url": url, "enabled_events[]": EVENTS, "description": "DailyClips Pro payments"})
lines = [l for l in open(env_file).read().splitlines() if not l.startswith(("STRIPE_SECRET_KEY=", "STRIPE_WEBHOOK_SECRET=", "STRIPE_PRICE_ID="))]
lines += ["STRIPE_SECRET_KEY=" + key, "STRIPE_WEBHOOK_SECRET=" + hook["secret"], "STRIPE_PRICE_ID=" + price["id"]]
open(env_file, "w").write("\n".join(lines) + "\n")
print("livemode", prod["livemode"], "| product", prod["id"], "| price", price["id"], "%.2f EUR one-time" % (amount / 100), "| webhook", hook["id"], hook["url"])
