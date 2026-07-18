"""Step 10 -- export to ONNX for CPU inference inside the Electron app.

The exported graph has a fixed CROP-shaped input path: you feed it the same upscaled ROI
crop that 08_predict.py feeds. Anything else and the blade arrives at a scale the network
never trained on.

`onnxruntime` on CPU is the natural sibling of the MediaPipe pose model already in the app.
`--simplify` folds constants; `--half` is deliberately NOT used, since CPU fp16 is usually
slower than fp32.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ultralytics import YOLO

from bladekit.core import load_json, resolve_object, save_json


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--weights", default=None)
    ap.add_argument("--format", default="onnx", choices=["onnx", "torchscript", "coreml"])
    ap.add_argument("--opset", type=int, default=17)
    args = ap.parse_args()

    paths = resolve_object(args.object)
    cfg = load_json(paths.predict_config)
    weights = args.weights or cfg.get("weights")
    if not weights or not Path(weights).exists():
        raise SystemExit(f"Weights not found: {weights}")
    imgsz = cfg.get("imgsz", 640)

    print(f"exporting {weights} -> {args.format} at imgsz={imgsz}")
    out = YOLO(str(weights)).export(format=args.format, imgsz=imgsz, opset=args.opset,
                                    simplify=True, half=False, device="cpu")

    manifest = {
        "model": str(out),
        "format": args.format,
        "imgsz": imgsz,
        "crop": cfg.get("crop", 320),
        "conf": cfg.get("conf", 0.25),
        "classes": {"0": "blade"},
        "preprocess": (
            f"crop a {cfg.get('crop', 320)}x{cfg.get('crop', 320)} window around the ROI center, "
            f"resize to {imgsz}x{imgsz}, BGR->RGB, /255, NCHW float32"
        ),
    }
    save_json(paths.meta / "export.json", manifest)
    print("\n" + json.dumps(manifest, indent=2))
    print(f"\nmanifest: {paths.meta / 'export.json'}")


if __name__ == "__main__":
    main()
