"""Step 11 -- measure real CPU inference cost, so imgsz is chosen from data.

The app runs on users' CPUs alongside MediaPipe pose and Whisper, and MPS timings say
nothing about that. This times the PyTorch model on CPU across candidate `imgsz` values and
reports both milliseconds per crop-window and the resulting frames per second.

Accuracy at a smaller imgsz is NOT measured here -- a smaller network input means fewer
pixels on a ~40 px blade, and the keypoints will drift. Use this to find what is affordable,
then re-train at that imgsz and check `09_evaluate.py` before believing it.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
from ultralytics import YOLO

from bladekit.core import load_json, resolve_object


def bench(model, imgsz: int, crop: int, reps: int, warmup: int) -> tuple[float, float]:
    """Returns (median ms, p90 ms) per window."""
    img = np.random.default_rng(0).integers(0, 255, (crop, crop, 3), dtype=np.uint8)
    for _ in range(warmup):
        model.predict(img, imgsz=imgsz, device="cpu", verbose=False)
    times = []
    for _ in range(reps):
        t0 = time.perf_counter()
        model.predict(img, imgsz=imgsz, device="cpu", verbose=False)
        times.append((time.perf_counter() - t0) * 1000.0)
    t = np.array(times)
    return float(np.median(t)), float(np.percentile(t, 90))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--weights", default=None)
    ap.add_argument("--imgsz", type=int, nargs="+", default=[640, 512, 416, 320])
    ap.add_argument("--reps", type=int, default=30)
    ap.add_argument("--warmup", type=int, default=5)
    ap.add_argument("--threads", type=int, default=0, help="0 = torch default.")
    ap.add_argument("--windows", type=int, default=1,
                    help="Windows per frame: 1 with a small ROI, ~6 when tiling the content box.")
    args = ap.parse_args()

    paths = resolve_object(args.object)
    cfg = load_json(paths.predict_config)
    weights = args.weights or cfg.get("weights")
    if not weights or not Path(weights).exists():
        raise SystemExit(f"Weights not found: {weights}")
    crop = cfg.get("crop", 320)
    trained_at = cfg.get("imgsz", 640)

    if args.threads:
        torch.set_num_threads(args.threads)
    print(f"weights={weights}")
    print(f"crop={crop}px  trained at imgsz={trained_at}  torch threads={torch.get_num_threads()}")
    print(f"timing {args.reps} reps per size, {args.windows} window(s) per frame\n")

    model = YOLO(str(weights))
    hdr = f"{'imgsz':>6} {'upscale':>8} {'ms/window':>10} {'p90':>7} {'ms/frame':>9} {'fps':>7}"
    print(hdr)
    print("-" * len(hdr))
    for imgsz in args.imgsz:
        med, p90 = bench(model, imgsz, crop, args.reps, args.warmup)
        per_frame = med * args.windows
        note = "  <- trained here" if imgsz == trained_at else ""
        print(f"{imgsz:6d} {imgsz / crop:7.2f}x {med:10.1f} {p90:7.1f} "
              f"{per_frame:9.1f} {1000.0 / per_frame:7.1f}{note}")

    print("\nA smaller imgsz costs accuracy: the blade is ~40 px in-frame, so at imgsz 320")
    print("(1.0x) it lands at 40 px on the network input instead of 80 px at 640.")
    print("Retrain at the size you pick and re-check 09_evaluate.py -- do not just")
    print("run the 640-trained model at 416 and hope.")


if __name__ == "__main__":
    main()
