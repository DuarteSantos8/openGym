#!/bin/sh
# usage: run.sh capture|probe   (env: BASE, SHA, OUT, RM, OUT_JSON, EXTRAS). Run from anywhere; needs a local Vite dev server (+ API for the proxy).
D=$(cd "$(dirname "$0")" && pwd)
cat "$D/common.py" "$D/$1_body.py" | EVID="$D" browser-harness
