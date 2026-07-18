"""Step 12 -- reference ONNX decoder, and the contract your app must reimplement.

The exported model takes one 1x3x640x640 float image (RGB, /255) and returns one tensor of
shape (1, 11, 8400): 8400 candidate detections, each 11 numbers laid out as

    [cx, cy, w, h,  conf,  kx0, ky0, kv0,  kx1, ky1, kv1]

all in the 640x640 network space. Box and keypoint coordinates are absolute pixels in that
space -- NOT normalized. There is no separate class score (single class), so `conf` is the
objectness/class confidence directly.

Postprocessing, which is what you port to C++/onnxruntime or cv::dnn:

  1. transpose to (8400, 11)
  2. keep rows with conf >= threshold
  3. NMS on the boxes (or, since one blade is in frame, just take argmax conf)
  4. map the kept keypoints from 640-space back to the crop, then to the full frame
  5. base = kp0 ; angle = atan2(kp1 - kp0)

This script does exactly that with numpy and checks it against the Ultralytics result on a
real crop, so you have a known-correct reference to match.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from bladekit.core import resolve_object
from bladekit.kpts import N_KPTS, angle_deg


def letterbox_to_square(crop: np.ndarray, imgsz: int) -> np.ndarray:
    """Ultralytics resizes the (already square) crop straight to imgsz. Match that exactly:
    a plain resize, no padding, since our crops are square by construction."""
    return cv2.resize(crop, (imgsz, imgsz), interpolation=cv2.INTER_LINEAR)


def preprocess(crop: np.ndarray, imgsz: int) -> np.ndarray:
    img = letterbox_to_square(crop, imgsz)
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    return np.ascontiguousarray(img.transpose(2, 0, 1)[None])  # 1x3xHxW


def decode(output: np.ndarray, conf_thresh: float) -> list[dict]:
    """output: (1, 4+1+3*K, 8400) -> list of detections in 640-space."""
    pred = output[0].T  # (8400, 11)
    conf = pred[:, 4]
    keep = conf >= conf_thresh
    pred = pred[keep]
    dets = []
    for row in pred:
        cx, cy, w, h = row[:4]
        kp = row[5:].reshape(N_KPTS, 3)  # x, y, vis
        dets.append({
            "box": np.array([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], np.float32),
            "conf": float(row[4]),
            "kpts": kp[:, :2].astype(np.float32),
        })
    return dets


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--conf", type=float, default=0.25)
    args = ap.parse_args()

    paths = resolve_object(args.object)
    manifest = json.loads((paths.meta / "export.json").read_text())
    onnx_path = manifest["model"]
    imgsz, crop = manifest["imgsz"], manifest["crop"]
    if not Path(onnx_path).exists():
        raise SystemExit(f"ONNX not found: {onnx_path}. Run 10_export.py first.")

    # A real crop: center a crop-sized window on a labeled blade.
    from bladekit.kpts import read_pose_label
    lab = next((p for p in sorted(paths.labels.glob("*.txt")) if p.read_text().strip()), None)
    if lab is None:
        raise SystemExit("No labeled frame to test on.")
    frame = cv2.imread(str(paths.frames / f"{lab.stem}.jpg"))
    h, w = frame.shape[:2]
    kps = read_pose_label(lab, w, h)[0][0]
    cx, cy = int(kps[:, 0].mean()), int(kps[:, 1].mean())
    x = int(np.clip(cx - crop // 2, 0, w - crop))
    y = int(np.clip(cy - crop // 2, 0, h - crop))
    patch = frame[y : y + crop, x : x + crop]

    # --- reference path: onnxruntime + the numpy decoder above ---
    import onnxruntime as ort

    sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    inp = sess.get_inputs()[0].name
    out = sess.run(None, {inp: preprocess(patch, imgsz)})[0]
    dets = decode(out, args.conf)
    print(f"onnx output shape: {out.shape}   detections >= {args.conf}: {len(dets)}")
    if not dets:
        raise SystemExit("decoder found nothing -- lower --conf or check the crop")
    best = max(dets, key=lambda d: d["conf"])
    scale = crop / imgsz  # 640-space -> crop-space
    onnx_kpts = best["kpts"] * scale + np.array([x, y], np.float32)  # -> full frame
    onnx_ang = angle_deg(onnx_kpts)

    # --- ground truth from ultralytics on the same crop ---
    from ultralytics import YOLO

    r = YOLO(manifest["model"].replace(".onnx", ".pt")).predict(
        patch, imgsz=imgsz, conf=args.conf, device="cpu", verbose=False)[0]
    yolo_kpts = r.keypoints.data.cpu().numpy()[0][:, :2] + np.array([x, y], np.float32)
    yolo_ang = angle_deg(yolo_kpts)

    print("\nreference decoder (what your app reimplements) vs Ultralytics:")
    print(f"  base   onnx {onnx_kpts[0].round(1).tolist()}   yolo {yolo_kpts[0].round(1).tolist()}"
          f"   diff {np.hypot(*(onnx_kpts[0] - yolo_kpts[0])):.2f} px")
    print(f"  angle  onnx {onnx_ang:.2f}   yolo {yolo_ang:.2f}   diff {abs(onnx_ang - yolo_ang):.2f} deg")
    ok = np.hypot(*(onnx_kpts[0] - yolo_kpts[0])) < 2.0
    print(f"\n{'MATCH -- the numpy decoder is correct, port it as-is' if ok else 'MISMATCH -- do not ship this decoder'}")


if __name__ == "__main__":
    main()
