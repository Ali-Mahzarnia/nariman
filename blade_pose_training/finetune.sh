#!/bin/bash
# Fast, non-destructive fine-tune of one blade, warm-started from its OWN current weights.
# Writes to runs/train/finetune/ so the original runs/train/blade/ weights stay intact.
#
#   bash finetune.sh 1        # fine-tune blade1, 40 epochs
#   bash finetune.sh 2 50     # blade2, 50 epochs
set -euo pipefail
cd "$(dirname "$0")"
N="${1:?usage: bash finetune.sh <1|2|3> [epochs]}"
EPOCHS="${2:-40}"
PY=.venv/bin/python

OBJ="objects/blade${N}"
WARM="$OBJ/runs/train/blade/weights/last.pt"
[ -f "$WARM" ] || { echo "warm-start weights missing: $WARM"; exit 1; }

mkdir -p "$OBJ/logs"
LOG="$OBJ/logs/finetune.log"
echo "fine-tuning blade${N} from $WARM  ($EPOCHS epochs) -> runs/train/finetune"
echo "log: $LOG"

nohup caffeinate -dimsu "$PY" 06_train.py \
  --object "$OBJ" \
  --model "$WARM" \
  --name finetune \
  --epochs "$EPOCHS" \
  --batch 16 \
  > "$LOG" 2>&1 &

echo "started pid $!  --  watch with:  tail -f $LOG"
