#!/bin/bash
# Predict on a video with the outlier gate + adaptive smoothing.
#
# Usage:
#   bash predict.sh blade2                      # test3.mp4, drag ROI on frame 0
#   bash predict.sh blade2 test.mp4             # a different clip
#   bash predict.sh blade2 test3.mp4 600,250,200,120   # fixed ROI, no dragging
#   bash predict.sh blade2 test3.mp4 none       # no ROI, tile the whole frame
set -euo pipefail

cd "$(dirname "$0")"
PY=.venv/bin/python
OBJ_NAME="${1:?usage: bash predict.sh <object> [video] [roi|none]}"
VIDEO="${2:-test3.mp4}"
ROI="${3:-drag}"

OBJ="objects/$OBJ_NAME"
[ -d "$OBJ" ] || { echo "no such object: $OBJ"; exit 1; }
# Name outputs by the video's basename, so an absolute path (e.g. a Desktop test clip)
# still lands inside the object's predict folder rather than a broken nested path.
STEM=$(basename "$VIDEO"); STEM="${STEM%.*}"
OUT="$OBJ/runs/predict/${STEM}.mp4"
CSV="$OBJ/runs/predict/${STEM}.csv"

ROI_ARGS=()
if [ "$ROI" = "none" ]; then
  ROI_ARGS=(--no-roi)
elif [ "$ROI" != "drag" ]; then
  ROI_ARGS=(--roi "$ROI" --show-roi --roi-strict)
else
  ROI_ARGS=(--roi-strict)   # dragged ROI is still a hard boundary
fi

# CONF env var overrides the calibrated threshold. The calibrated value maximizes F1 on a
# clean val set, which can sit very high (blade3 = 0.91) and then drop a partially-occluded
# handle in real footage. With a ~0 false-positive rate there is headroom to lower it.
CONF_ARGS=()
if [ -n "${CONF:-}" ]; then
  CONF_ARGS=(--conf "$CONF")
  echo "conf override: $CONF"
fi

# SMOOTH env overrides the 0.3 default. SMOOTH=0 turns off both smoothing AND the outlier
# gate, so you can tell a genuine model miss from a detection the gate rejected.
SMOOTH="${SMOOTH:-0.3}"
echo "smooth: $SMOOTH"

"$PY" 08_predict.py \
  --object "$OBJ" \
  --video "$VIDEO" \
  --best-only \
  --labels \
  --smooth "$SMOOTH" \
  ${ROI_ARGS[@]+"${ROI_ARGS[@]}"} \
  ${CONF_ARGS[@]+"${CONF_ARGS[@]}"} \
  --out "$OUT" \
  --csv "$CSV"

echo
echo "video: $OUT"
echo "csv:   $CSV"
