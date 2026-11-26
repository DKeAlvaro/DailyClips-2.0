#!/bin/sh
# Fills today's board with invented players as the day goes (server/lib/seed.mjs): run it from cron
# every half hour, so the count grows during the day instead of appearing all at once at midnight.
# The API does the writing, so the database keeps belonging to the service user.
#   */30 * * * * /opt/dailyclips/bin/seed
set -e
. /opt/dailyclips/env/prod.env
curl -fsS -m 30 -X POST -H "X-Admin: $DC_ADMIN" "http://127.0.0.1:${DC_PORT:-8821}/internal/seed?live=1"
echo " $(date -Is)"
