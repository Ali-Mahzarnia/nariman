#!/bin/bash
# Predict on the held-out test3.mp4 with the outlier gate + temporal smoothing.
#
# Usage:
#   bash predict_test3.sh          # whatever meta/predict_config.json points at
#   bash predict_test3.sh last     # force last.pt  (epoch 135)
#   bash predict_test3.sh best     # force best.pt  (epoch 13, mAP-selected)
set -euo pipefail

cd "$(dirname "$0")"
PY=.venv/bin/python
OBJ=objects/blade1
OUT=$OBJ/runs/predict
CKPT="${1:-}"

EXTRA=()
TAG="cfg"
if [ "$CKPT" = "last" ]; then
  EXTRA=(--weights "$OBJ/runs/train/blade/weights/last.pt" --conf 0.616)
  TAG="last"
elif [ "$CKPT" = "best" ]; then
  EXTRA=(--weights "$OBJ/runs/train/blade/weights/best.pt" --conf 0.497)
  TAG="best"
fi

"$PY" 08_predict.py \
  --object "$OBJ" \
  --video test3.mp4 \
  --roi 600,250,200,120 \
  --best-only \
  --labels \
  --show-roi \
  --smooth 0.3 \
  "${EXTRA[@]}" \
  --out "$OUT/test3_${TAG}.mp4" \
  --csv "$OUT/test3_smooth.csv"

echo
echo "=== raw vs smoothed, frame-to-frame angle change ==="
"$PY" - <<'PYEOF'
import csv, numpy as np
def load(p):
    rows = [r for r in csv.DictReader(open(p)) if r["angle_deg"]]
    return (np.array([float(r["angle_deg"]) for r in rows]),
            np.array([int(r["frame"]) for r in rows]))
def stats(a, fr):
    keep = np.diff(fr) == 1                      # only consecutive frames
    d = np.abs((np.diff(a) + 180) % 360 - 180)[keep]
    return len(a), np.median(d), np.percentile(d, 90), np.percentile(d, 99), d.max()

print(f"{'file':<12} {'n':>5} {'med':>7} {'p90':>7} {'p99':>7} {'max':>8}")
print("-" * 50)
for label, path in (("raw", "objects/blade1/runs/predict/test3.csv"),
                    ("smoothed", "objects/blade1/runs/predict/test3_smooth.csv")):
    try:
        n, m, p90, p99, mx = stats(*load(path))
        print(f"{label:<12} {n:5d} {m:7.2f} {p90:7.2f} {p99:7.2f} {mx:8.1f}")
    except FileNotFoundError:
        print(f"{label:<12} (missing: {path})")
PYEOF
