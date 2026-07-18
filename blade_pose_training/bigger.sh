#!/bin/bash
# Cold-start experiment: same accumulated labels, a bigger backbone (yolo11s-pose, ~9.9M
# params vs nano's 2.6M) to test whether more capacity helps infer occluded (finger-covered)
# keypoints. Can't warm-start across architectures, so this starts from COCO's yolo11s-pose.pt.
# Writes to runs/train/bigger/ -- does not touch runs/train/blade or runs/train/finetune.
#   bash bigger.sh 1          # blade1, 100 epochs
#   bash bigger.sh 2 120      # blade2, 120 epochs
set -euo pipefail
cd "$(dirname "$0")"
N="${1:?usage: bash bigger.sh <1|2|3> [epochs]}"
EPOCHS="${2:-100}"
PY=.venv/bin/python

OBJ="objects/blade${N}"
mkdir -p "$OBJ/logs"
LOG="$OBJ/logs/bigger.log"
echo "cold-start blade${N} from yolo11s-pose.pt ($EPOCHS epochs) -> runs/train/bigger"
echo "log: $LOG"

nohup caffeinate -dimsu "$PY" 06_train.py \
  --object "$OBJ" \
  --model yolo11s-pose.pt \
  --name bigger \
  --epochs "$EPOCHS" \
  --batch 16 \
  > "$LOG" 2>&1 &

echo "started pid $!  --  watch with:  tail -f $LOG"
