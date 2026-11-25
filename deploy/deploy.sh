#!/bin/sh
# Run on the server as root:  deploy.sh staging|prod
# Pulls the checkout of that instance, rebuilds the front end and restarts its service.
set -e
umask 022
inst=${1:?usage: deploy.sh staging|prod}
cd /opt/dailyclips/"$inst"
as() { runuser -u dailyclips -- "$@"; }
before=$(as git rev-parse HEAD)
as git pull -q --ff-only
if [ ! -d node_modules ] || ! as git diff --quiet "$before" HEAD -- package-lock.json; then
  as npm ci --omit=dev --no-audit --no-fund --silent
fi
as node build.mjs
systemctl restart dailyclips@"$inst"
# the Pro scorer runs from the prod checkout: restart it only when its code changed
if [ "$inst" = prod ] && systemctl is-enabled -q dailyclips-scorer 2>/dev/null && ! as git diff --quiet "$before" HEAD -- scorer/; then
  systemctl restart dailyclips-scorer
fi
sleep 1
systemctl is-active dailyclips@"$inst"
