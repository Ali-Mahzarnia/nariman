"""Step 7 -- harvest the model's own false positives and feed them back as negatives.

This is the cheapest large win available. The model is run over every frame you marked
negative -- frames guaranteed to hold no blade -- at a deliberately low confidence. Anything
it detects is, by definition, a false positive. Those crops become new negative training
data, and the next round of training pushes their scores down.

Two or three rounds of this is usually what separates a model that needs conf=0.08 from one
that works at conf=0.5.

After running this: rebuild (04) and retrain (06). Both pick up `hard_negatives/`
automatically.
"""

from __future__ import annotations

import argparse
import json
import shutil

import cv2
import numpy as np
from ultralytics import YOLO

from bladekit.core import load_json, pick_device, resolve_object
from bladekit.crops import clamp_window
from bladekit.infer import CropDetector
from bladekit.kpts import is_negative_pose


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--weights", default=None, help="Defaults to meta/predict_config.json.")
    ap.add_argument("--conf", type=float, default=0.05,
                    help="Low on purpose: we want the near-misses, not just the confident errors.")
    ap.add_argument("--max-per-frame", type=int, default=3)
    ap.add_argument("--max-total", type=int, default=600)
    ap.add_argument("--reset", action="store_true", help="Clear previously mined negatives first.")
    args = ap.parse_args()

    paths = resolve_object(args.object)
    cfg = load_json(paths.predict_config)
    weights = args.weights or cfg.get("weights")
    if not weights:
        raise SystemExit("No weights. Train first (06_train.py) or pass --weights.")

    manifest = json.loads((paths.dataset / "manifest.json").read_text())
    crop, imgsz = manifest["crop"], cfg.get("imgsz", 640)

    if args.reset and paths.hard_negatives.exists():
        shutil.rmtree(paths.hard_negatives)
    paths.hard_negatives.mkdir(parents=True, exist_ok=True)
    existing = len(list(paths.hard_negatives.glob("*.jpg")))

    negatives = [p for p in sorted(paths.frames.glob("*.jpg"))
                 if is_negative_pose(paths.labels / f"{p.stem}.txt")]
    if not negatives:
        raise SystemExit("No negative frames. Mark some with `x` in 02_browse_label.py.")

    detector = CropDetector(YOLO(str(weights)), crop, imgsz, args.conf, pick_device())
    print(f"weights={weights}")
    print(f"scanning {len(negatives)} blade-free frames at conf={args.conf} ...")

    mined = 0
    frames_hit = 0
    confs: list[float] = []
    for i, p in enumerate(negatives, 1):
        if mined >= args.max_total:
            break
        img = cv2.imread(str(p))
        if img is None:
            continue
        h, w = img.shape[:2]
        det = detector.detect(img)
        if len(det) == 0:
            continue
        frames_hit += 1

        order = np.argsort(-det.confs)[: args.max_per_frame]
        for j in order:
            if mined >= args.max_total:
                break
            b = det.boxes[j]
            cx, cy = int((b[0] + b[2]) / 2), int((b[1] + b[3]) / 2)
            x, y, cw, ch = clamp_window(cx, cy, crop, w, h)
            patch = img[y : y + ch, x : x + cw]
            if patch.shape[0] != crop or patch.shape[1] != crop:
                continue
            name = f"fp_{existing + mined:05d}_{p.stem}_{int(det.confs[j] * 1000):04d}.jpg"
            cv2.imwrite(str(paths.hard_negatives / name), patch, [int(cv2.IMWRITE_JPEG_QUALITY), 96])
            confs.append(float(det.confs[j]))
            mined += 1

        if i % 25 == 0:
            print(f"  {i}/{len(negatives)} frames, {mined} mined")

    print(f"\nfalse positives on blade-free frames: {frames_hit}/{len(negatives)} frames")
    print(f"mined {mined} crops -> {paths.hard_negatives}  (total now {existing + mined})")
    if confs:
        c = np.array(confs)
        print(f"their confidence: med={np.median(c):.3f}  max={c.max():.3f}")
        if c.max() > 0.5:
            print("  ^ some fire above 0.5. Worth a second mining round after retraining.")
    else:
        print("Clean: the model found nothing on blade-free frames. No retrain needed for FPs.")
        return

    print(f"\nNext:\n  python 04_build_dataset.py --object {args.object}")
    print(f"  python 06_train.py --object {args.object}")


if __name__ == "__main__":
    main()
