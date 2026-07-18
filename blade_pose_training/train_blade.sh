#!/bin/bash
# Launch a warm-started training run in the background, surviving terminal close and sleep.
#
# Usage:
#   bash train_blade.sh blade2            # fine-tune from blade1, 80 epochs
#   bash train_blade.sh blade3 100        # override epoch count
#   bash train_blade.sh blade2 80 scratch # start from COCO instead of blade1
set -euo pipefail

cd "$(dirname "$0")"
PY=.venv/bin/python
OBJ_NAME="${1:?usage: bash train_blade.sh <object> [epochs] [scratch]}"
EPOCHS="${2:-80}"
MODE="${3:-warm}"

OBJ="objects/$OBJ_NAME"
[ -d "$OBJ" ] || { echo "no such object: $OBJ"; exit 1; }

MODEL_ARGS=()
if [ "$MODE" = "warm" ]; then
  WARM=objects/blade1/runs/train/blade/weights/last.pt
  [ -f "$WARM" ] || { echo "warm-start weights missing: $WARM"; exit 1; }
  MODEL_ARGS=(--model "$WARM")
  echo "warm start from $WARM"
else
  echo "cold start from yolo11n-pose.pt"
fi

mkdir -p "$OBJ/logs"
LOG="$OBJ/logs/train.log"

nohup caffeinate -dimsu "$PY" 06_train.py \
  --object "$OBJ" \
  "${MODEL_ARGS[@]}" \
  --epochs "$EPOCHS" \
  --batch 16 \
  > "$LOG" 2>&1 &

PID=$!
echo "training $OBJ_NAME started, pid $PID, $EPOCHS epochs"
echo "watch:  tr '\\r' '\\n' < $LOG | grep -A14 'WHAT YOU SHIP'"
