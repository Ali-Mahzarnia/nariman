#!/bin/bash
# Rebuild + cold-start train blade2, THEN blade3, sequentially, unattended.
# Survives terminal close and sleep. Each step BLOCKS until done before the next starts.
#   bash run_blade23.sh
set -euo pipefail
cd "$(dirname "$0")"
PY=.venv/bin/python

for N in 2 3; do
  OBJ="objects/blade${N}"
  mkdir -p "$OBJ/logs"
  echo "===== blade${N}: rebuilding dataset =====" | tee -a "$OBJ/logs/chain.log"
  "$PY" 04_build_dataset.py --object "$OBJ" 2>&1 | tee -a "$OBJ/logs/chain.log"

  echo "===== blade${N}: training (cold-start, 100ep ceiling, patience 40) =====" | tee -a "$OBJ/logs/chain.log"
  "$PY" 06_train.py --object "$OBJ" --model yolo11n-pose.pt --name clean \
    --epochs 100 --patience 40 --batch 16 2>&1 | tee -a "$OBJ/logs/chain.log"

  echo "===== blade${N}: DONE =====" | tee -a "$OBJ/logs/chain.log"
done

echo "ALL DONE: blade2 and blade3 both trained." | tee -a objects/blade2/logs/chain.log
