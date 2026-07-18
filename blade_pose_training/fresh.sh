#!/bin/bash
# Cold-start retrain, nano architecture, on the label set you just corrected during review.
# Full schedule like the very first training (200 epochs, patience 40, cosine LR decay --
# more epochs means the LR is spread thinner per epoch, closer to how the originals were
# trained, as opposed to the fast 40-epoch warm-start fine-tunes).
# Writes to runs/train/clean/ -- does NOT touch runs/train/blade (your original) or
# runs/train/finetune or runs/train/bigger.
#   bash fresh.sh 1          # blade1, 200 epochs
#   bash fresh.sh 1 150      # override epoch count
set -euo pipefail
cd "$(dirname "$0")"
N="${1:?usage: bash fresh.sh <1|2|3> [epochs]}"
EPOCHS="${2:-100}"
PY=.venv/bin/python

OBJ="objects/blade${N}"
mkdir -p "$OBJ/logs"
LOG="$OBJ/logs/fresh.log"
echo "cold-start blade${N} from yolo11n-pose.pt ($EPOCHS epochs, patience 40) -> runs/train/clean"
echo "log: $LOG"

nohup caffeinate -dimsu "$PY" 06_train.py \
  --object "$OBJ" \
  --model yolo11n-pose.pt \
  --name clean \
  --epochs "$EPOCHS" \
  --patience 40 \
  --batch 16 \
  > "$LOG" 2>&1 &

echo "started pid $!  --  watch with:  tail -f $LOG"
