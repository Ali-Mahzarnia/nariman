"""Fast sanity check: how well does the model fit the crops it was actually TRAINED on?

If train-set error is high, something is structurally broken (wrong weights, bad crop math,
label bug) -- not just a generalization/occlusion gap. If train-set error is low (as
expected -- the model has seen these exact pixels), that confirms the val-set gap we're
chasing is real generalization/occlusion, not a pipeline bug.
"""
import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

sys.path.insert(0, str(Path(__file__).parent))
from bladekit.core import resolve_object
from bladekit.kpts import angle_deg, kpts_to_bbox, read_pose_label

ap = argparse.ArgumentParser()
ap.add_argument("--object", default="objects/blade1")
ap.add_argument("--weights", required=True)
ap.add_argument("--split", default="train", choices=["train", "val"])
ap.add_argument("--conf", type=float, default=0.1)
args = ap.parse_args()

paths = resolve_object(args.object)
model = YOLO(args.weights)
images = sorted((paths.dataset / "images" / args.split).glob("pos_*.jpg"))
labels_dir = paths.dataset / "labels" / args.split
print(f"{len(images)} positive {args.split} crops")

base_errs, ang_errs = [], []
misses = 0
for img_path in images:
    img = cv2.imread(str(img_path))
    h, w = img.shape[:2]
    gt = read_pose_label(labels_dir / f"{img_path.stem}.txt", w, h)
    if not gt:
        continue
    gt_kps = gt[0][0]
    r = model.predict(source=img, conf=args.conf, imgsz=640, device="cpu", verbose=False)[0]
    if r.boxes is None or len(r.boxes) == 0:
        misses += 1
        continue
    i = int(r.boxes.conf.argmax())
    pk = r.keypoints.data.cpu().numpy()[i][:, :2]
    base_errs.append(float(np.hypot(*(pk[0] - gt_kps[0]))))
    ang_errs.append(abs(angle_deg(pk) - angle_deg(gt_kps)))

base_errs, ang_errs = np.array(base_errs), np.array(ang_errs)
print(f"matched: {len(base_errs)}   missed entirely: {misses}")
print(f"base_err_px   median={np.median(base_errs):.2f}  p90={np.percentile(base_errs,90):.2f}")
print(f"angle_err_deg median={np.median(ang_errs):.2f}  p90={np.percentile(ang_errs,90):.2f}")
