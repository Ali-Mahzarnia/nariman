#!/bin/bash
# Hunt and label FINGER-OVER-HANDLE frames (the occlusion cases the model fails on).
# Small stride so brief finger moments aren't skipped. Saves into the same frames/labels
# dirs, so they mix into the next retrain.
#   bash fingers.sh 1        (or 2, 3)     start at frame 0
#   bash fingers.sh 1 1500                 start at frame 1500
set -euo pipefail
cd "$(dirname "$0")"
N="${1:?usage: bash fingers.sh <1|2|3> [start_frame]}"
START="${2:-0}"
PY=.venv/bin/python
"$PY" label_finetune.py \
  --object "objects/blade${N}" \
  --video "longs/long_blade${N}.mp4" \
  --stride 3 \
  --start "$START"
