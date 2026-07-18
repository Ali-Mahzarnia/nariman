"""Step 6 -- train the pose model, then calibrate conf and report base/angle error.

Design notes that matter:

* `imgsz=640` on 320 px crops is a deliberate 2x upscale. Keypoint precision scales with
  pixels on target, and the handle is ~40 px in the source frame.
* `degrees=180` because the blade is rigid and can appear at any roll angle. Ultralytics
  rotates the keypoints with the image, so this is free supervision.
* `flip_idx = [0, 1]` (identity, set in data.yaml): base and direction are distinct semantic
  points, not a left/right pair, so a horizontal flip must not swap them.
* `single_cls=True`: one class, so skip the multi-class machinery.

Training ends by sweeping the PR curve on the real-only val split for the max-F1
confidence, then measuring what you actually ship: median base error in pixels and median
angle error in degrees. The log tells you the threshold to predict with.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

from bladekit.core import pick_device, resolve_object, save_json
from bladekit.kpts import V_VISIBLE, angle_deg, angle_error_deg, kpts_to_bbox, read_pose_label


def find_base(name: str) -> str:
    here = Path(__file__).resolve().parent
    for root in (here, here.parent):
        if (root / name).exists():
            return str(root / name)
    return name  # ultralytics fetches it


def iou(a, b) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return float(inter / union) if union > 0 else 0.0


def calibrate(weights: Path, dataset: Path, imgsz: int, device: str, iou_thresh: float = 0.5) -> dict:
    """Max-F1 confidence on the real-only val split, plus geometric error at that threshold.

    mAP tells you how the ranking behaves. It does not tell you which threshold to deploy,
    nor how many pixels off the base is -- and those are the only numbers you ship.
    """
    model = YOLO(str(weights))
    images = sorted((dataset / "images" / "val").glob("*.jpg"))
    labels = dataset / "labels" / "val"

    scored: list[tuple[float, int]] = []
    n_gt = 0
    neg_top: list[float] = []
    n_neg = 0
    # (conf, base_err_px, angle_err_deg, base_was_visible)
    matched: list[tuple[float, float, float, bool]] = []

    for img_path in images:
        img = cv2.imread(str(img_path))
        if img is None:
            continue
        h, w = img.shape[:2]
        gt = read_pose_label(labels / f"{img_path.stem}.txt", w, h)
        gt_boxes = [kpts_to_bbox(k) for k, _ in gt]
        n_gt += len(gt)
        if not gt:
            n_neg += 1

        r = model.predict(source=img, conf=0.001, imgsz=imgsz, device=device, verbose=False)[0]
        if r.boxes is None or len(r.boxes) == 0:
            continue
        boxes = r.boxes.xyxy.cpu().numpy()
        confs = r.boxes.conf.cpu().numpy()
        kpred = (r.keypoints.data.cpu().numpy() if r.keypoints is not None and r.keypoints.data is not None
                 else np.zeros((len(boxes), 2, 3), np.float32))

        if not gt:
            neg_top.append(float(confs.max()))

        used: set[int] = set()
        for i in np.argsort(-confs):
            best_j, best = -1, iou_thresh
            for j, g in enumerate(gt_boxes):
                if j in used:
                    continue
                v = iou(boxes[i], g)
                if v >= best:
                    best_j, best = j, v
            if best_j >= 0:
                used.add(best_j)
                scored.append((float(confs[i]), 1))
                gk, gv = gt[best_j]
                pk = kpred[i][:, :2]
                matched.append((float(confs[i]),
                                float(np.hypot(*(pk[0] - gk[0]))),
                                angle_error_deg(angle_deg(pk), angle_deg(gk)),
                                bool(gv[0] == V_VISIBLE)))
            else:
                scored.append((float(confs[i]), 0))

    if not scored or n_gt == 0:
        return {"conf": 0.25, "note": "calibration skipped (no detections or no ground truth)"}

    scored.sort(key=lambda t: -t[0])
    tp = fp = 0
    best = {"f1": -1.0, "conf": 0.25, "precision": 0.0, "recall": 0.0}
    for conf, is_tp in scored:
        tp += is_tp
        fp += 1 - is_tp
        prec, rec = tp / (tp + fp), tp / n_gt
        f1 = 0.0 if prec + rec == 0 else 2 * prec * rec / (prec + rec)
        if f1 > best["f1"]:
            best = {"f1": f1, "conf": conf, "precision": prec, "recall": rec}

    c = best["conf"]
    sel = [(be, ae, vis) for cf, be, ae, vis in matched if cf >= c]
    fp_rate = float(np.mean([t >= c for t in neg_top])) if neg_top else 0.0

    out = {
        "conf": round(float(c), 4),
        "f1": round(float(best["f1"]), 4),
        "precision": round(float(best["precision"]), 4),
        "recall": round(float(best["recall"]), 4),
        "gt_instances": n_gt,
        "negative_crops": n_neg,
        "false_positive_rate_on_negatives": round(fp_rate, 4),
    }
    if sel:
        be = np.array([s[0] for s in sel])
        ae = np.array([s[1] for s in sel])
        out.update({
            "base_err_px_median": round(float(np.median(be)), 2),
            "base_err_px_p90": round(float(np.percentile(be, 90)), 2),
            "angle_err_deg_median": round(float(np.median(ae)), 2),
            "angle_err_deg_p90": round(float(np.percentile(ae, 90)), 2),
            "flipped_180_rate": round(float(np.mean(ae > 90)), 4),
        })
        # Split by whether the ground-truth base was visible. Predicting a base buried in a
        # fist is a different, harder task than locating one you can see, and averaging the
        # two hides exactly the number that decides whether this model is deployable.
        for name, keep in (("visible", [s for s in sel if s[2]]),
                           ("occluded", [s for s in sel if not s[2]])):
            if not keep:
                continue
            b = np.array([s[0] for s in keep])
            a = np.array([s[1] for s in keep])
            out[f"base_err_px_median_{name}"] = round(float(np.median(b)), 2)
            out[f"angle_err_deg_median_{name}"] = round(float(np.median(a)), 2)
            out[f"n_{name}"] = len(keep)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--model", default="yolo11n-pose.pt")
    ap.add_argument("--name", default="blade")
    ap.add_argument("--epochs", type=int, default=200)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--patience", type=int, default=40)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--quick", action="store_true", help="Short bootstrap run for the pseudo-label loop.")
    args = ap.parse_args()

    paths = resolve_object(args.object)
    data = paths.dataset / "data.yaml"
    if not data.exists():
        raise SystemExit(f"No dataset at {data}. Run 04_build_dataset.py first.")
    crop = json.loads((paths.dataset / "manifest.json").read_text())["crop"]

    epochs = 40 if args.quick else args.epochs
    patience = 12 if args.quick else args.patience
    name = f"{args.name}_quick" if args.quick else args.name
    device = pick_device()
    weights = args.model if Path(args.model).exists() else find_base(args.model)

    if args.resume:
        # Ultralytics resumes from the *run's* last.pt, which carries the optimizer state and
        # epoch counter. Handing it the pretrained checkpoint would silently restart from
        # epoch 0 -- and you would only notice hours later, from the epoch numbers.
        last = paths.runs / "train" / name / "weights" / "last.pt"
        if not last.exists():
            raise SystemExit(f"--resume needs {last}, which does not exist.")
        weights = str(last)
        print(f"resuming from {last}")

    print(f"model={weights} device={device} crop={crop} imgsz={args.imgsz} "
          f"(x{args.imgsz / crop:.1f} upscale) batch={args.batch}")

    YOLO(weights).train(
        data=str(data),
        epochs=epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        workers=args.workers,
        device=device,
        project=str(paths.runs / "train"),
        name=name,
        exist_ok=True,
        resume=args.resume,
        seed=args.seed,
        patience=patience,
        cache="ram",
        amp=True,
        plots=True,
        single_cls=True,
        cos_lr=True,
        # Rigid object, any roll angle, fixed camera: rotate freely, never shear.
        degrees=180.0,
        translate=0.10,
        scale=0.30,
        shear=0.0,
        perspective=0.0,
        fliplr=0.5,
        flipud=0.5,
        mosaic=1.0,
        close_mosaic=max(5, min(15, epochs // 8)),
        erasing=0.20,
        hsv_h=0.015,
        hsv_s=0.50,
        hsv_v=0.40,
    )

    wdir = paths.runs / "train" / name / "weights"
    best, last = wdir / "best.pt", wdir / "last.pt"
    if not best.exists():
        raise SystemExit(f"training produced no weights at {best}")

    # Ultralytics selects best.pt by pose mAP, whose OKS tolerance scales with box area --
    # and our box is a fixed square, so the metric saturates near 0.99 while the base is
    # still creeping toward the right pixel. Choose on what we ship: median base error,
    # tie-broken by angle error. Often that is last.pt, not best.pt.
    print("\n" + "=" * 78)
    print("calibrating on the real-only val split ...")
    candidates = [("best.pt", best)] + ([("last.pt", last)] if last.exists() else [])
    scored = []
    for label, w in candidates:
        c = calibrate(w, paths.dataset, args.imgsz, device)
        key = (c.get("base_err_px_median", 1e9), c.get("angle_err_deg_median", 1e9))
        scored.append((key, label, w, c))
        print(f"  {label:8s} conf={c['conf']:.3f}  base_err={c.get('base_err_px_median', float('nan')):.2f} px"
              f"  angle_err={c.get('angle_err_deg_median', float('nan')):.2f} deg"
              f"  fp_rate={c.get('false_positive_rate_on_negatives', 0):.3f}")

    scored.sort(key=lambda t: t[0])
    _, chosen_label, chosen, cal = scored[0]
    if len(scored) > 1:
        print(f"\n  choosing {chosen_label} (lower base error). "
              f"mAP would have picked best.pt regardless.")

    save_json(paths.predict_config, {
        "weights": str(chosen), "crop": crop, "imgsz": args.imgsz,
        "conf": cal["conf"], "chosen_checkpoint": chosen_label, "calibration": cal,
    })

    print("\n" + "=" * 78)
    print("WHAT YOU SHIP")
    print("=" * 78)
    for k, v in cal.items():
        print(f"  {k:34s} {v}")
    print(f"\n  written to {paths.predict_config}")
    print("\nRun this:\n")
    print(f"  python 08_predict.py --object {args.object} \\")
    print(f"      --video test3.mp4 --conf {cal['conf']} --best-only --show-roi")
    print("\n(omit --conf to read it from predict_config.json)")

    if cal.get("flipped_180_rate", 0) > 0.02:
        print(f"\nWARNING: {cal['flipped_180_rate']:.1%} of matches are >90 deg off -- the model has")
        print("the handle pointing backwards. Check your labels in 02 (`w` reverses the arrow).")
    if cal.get("false_positive_rate_on_negatives", 0) > 0.05:
        print("\nNOTE: this model still fires on blade-free crops. Run:")
        print(f"  python 07_mine_negatives.py --object {args.object}")
        print(f"  python 04_build_dataset.py --object {args.object}")
        print(f"  python 06_train.py --object {args.object}")
    print("=" * 78)


if __name__ == "__main__":
    main()
