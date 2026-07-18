#!/bin/bash
# Review/correct EXISTING saved labels (no video, no model) before retraining.
#   bash review.sh 1              # all positive labels for blade1
#   bash review.sh 1 ft_          # only your relabeled ft_ frames
set -euo pipefail
cd "$(dirname "$0")"
N="${1:?usage: bash review.sh <1|2|3> [prefix]}"
PY=.venv/bin/python
if [ -n "${2:-}" ]; then
  "$PY" review_labels.py --object "objects/blade${N}" --prefix "$2"
else
  "$PY" review_labels.py --object "objects/blade${N}"
fi
