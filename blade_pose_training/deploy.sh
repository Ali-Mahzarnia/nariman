#!/bin/bash
# Back up the app's current bladeN.onnx, then drop in the freshly exported fine-tuned model.
#   bash deploy.sh 1     (or 2, or 3)
set -euo pipefail
cd "$(dirname "$0")"
N="${1:?usage: bash deploy.sh <1|2|3>}"
SRC="objects/blade${N}/runs/train/finetune/weights/last.onnx"
DST="../resources/models/blade${N}.onnx"
[ -f "$SRC" ] || { echo "exported model missing: $SRC (run 10_export.py first)"; exit 1; }
[ -f "$DST" ] && cp "$DST" "${DST}.bak" && echo "backed up old -> ${DST}.bak"
cp "$SRC" "$DST"
echo "deployed $SRC -> $DST"
ls -la "$DST" "${DST}.bak"
