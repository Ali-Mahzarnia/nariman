#!/bin/bash
# Run the NEWLY fine-tuned model through the same predict/relabel tool, to see if it now
# gets the hard frames right. Defaults to starting at frame 1500 so you look at frames the
# model was NOT trained on (you labeled ~0-1330). Pass a start frame to override.
#   bash testnew.sh 1              # blade1, run "finetune", from frame 1500
#   bash testnew.sh 1 3000         # blade1, run "finetune", from frame 3000
#   bash testnew.sh 1 3000 clean   # blade1, run "clean" (fresh.sh output), from frame 3000
set -euo pipefail
cd "$(dirname "$0")"
N="${1:?usage: bash testnew.sh <1|2|3> [start_frame] [run_name]}"
START="${2:-1500}"
RUN="${3:-finetune}"
PY=.venv/bin/python
"$PY" label_finetune.py \
  --object "objects/blade${N}" \
  --video "longs/long_blade${N}.mp4" \
  --weights "objects/blade${N}/runs/train/${RUN}/weights/last.pt" \
  --start "$START"
