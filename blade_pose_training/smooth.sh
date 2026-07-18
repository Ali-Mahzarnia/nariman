#!/bin/bash
# Run the current model on a long video WITH temporal smoothing (EMA + outlier gate),
# the way the app is supposed to. Writes an annotated mp4 you can scrub to the finger frames.
#   bash smooth.sh 1                    # alpha 0.2, turn 15, hold through 20 rejected frames
#   bash smooth.sh 1 0.2 15 40 0.4      # hold longer + lower conf (recover misses under heavy occlusion)
# args:  N  [alpha]  [max_turn_deg]  [reset_after]  [conf]
set -euo pipefail
cd "$(dirname "$0")"
N="${1:?usage: bash smooth.sh <1|2|3> [alpha] [max_turn_deg] [reset_after] [conf]}"
ALPHA="${2:-0.2}"
MAXTURN="${3:-15}"
RESET="${4:-20}"
CONF="${5:-}"
PY=.venv/bin/python
OUT="longs/smoothed_blade${N}.mp4"
CONF_ARGS=()
[ -n "$CONF" ] && CONF_ARGS=(--conf "$CONF")
"$PY" 08_predict.py \
  --object "objects/blade${N}" \
  --video "longs/long_blade${N}.mp4" \
  --best-only --roi-strict --show-roi \
  --smooth "$ALPHA" \
  --max-turn-deg "$MAXTURN" \
  --reset-after "$RESET" \
  "${CONF_ARGS[@]}" \
  --out "$OUT"
echo "wrote $OUT  -- open it and scrub to a finger-over-handle moment"
