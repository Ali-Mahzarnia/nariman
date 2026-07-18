#!/bin/bash
# Usage: bash label.sh 1     (or 2, or 3)  -> label longs/long_bladeN.mp4 into objects/bladeN
set -euo pipefail
cd "$(dirname "$0")"
N="${1:?usage: bash label.sh <1|2|3>}"
PY=.venv/bin/python
"$PY" label_finetune.py --object "objects/blade${N}" --video "longs/long_blade${N}.mp4" "${@:2}"
