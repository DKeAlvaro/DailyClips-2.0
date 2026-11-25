#!/bin/sh
# Daily cron (a minute past midnight is fine): asks the API to publish today's clip.
# The API also publishes by itself on the first request of the day; this run adds the check that
# YouTube still serves the video and skips to the next clip in the queue when it does not.
set -e
. /opt/dailyclips/env/prod.env
curl -fsS -m 60 -X POST -H "X-Admin: $DC_ADMIN" "http://127.0.0.1:${DC_PORT:-8821}/internal/publish"
echo " $(date -Is)"
