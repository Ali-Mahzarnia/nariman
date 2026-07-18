"""Step 9 -- score checkpoints on the real-only validation split.

Reports the two numbers you ship -- median base error in pixels, median angle error in
degrees -- alongside standard detection metrics. Because train and val crops are cut the
same way inference cuts the ROI, these numbers predict deployment behavior directly.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from ultralytics import YOLO

import json

from bladekit.core import load_json, pick_device, resolve_object, save_json


def _load_calibrate():
    """`06_train` starts with a digit, so it cannot be imported by name."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("train_mod", Path(__file__).parent / "06_train.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.calibrate


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--weights", nargs="+", default=None)
    ap.add_argument("--imgsz", type=int, default=None)
    ap.add_argument("--save", action="store_true",
                    help="Point meta/predict_config.json at the checkpoint with the lowest "
                         "base error (ties broken on angle error).")
    args = ap.parse_args()

    paths = resolve_object(args.object)
    data = paths.dataset / "data.yaml"
    if not data.exists():
        raise SystemExit(f"No dataset at {data}")

    cfg = load_json(paths.predict_config)
    weights = args.weights or ([cfg["weights"]] if cfg.get("weights") else [])
    if not weights:
        raise SystemExit("No weights. Train first, or pass --weights.")
    imgsz = args.imgsz or cfg.get("imgsz", 640)
    device = pick_device()
    calibrate = _load_calibrate()

    rows = []
    for w in weights:
        if not Path(w).exists():
            print(f"skip (missing): {w}")
            continue
        r = YOLO(w).val(data=str(data), imgsz=imgsz, device=device, plots=False, verbose=False)
        cal = calibrate(Path(w), paths.dataset, imgsz, device)
        # Label by the checkpoint file, not the run directory -- best.pt and last.pt live in
        # the same run and would otherwise print as the same name.
        label = f"{Path(w).parent.parent.name}/{Path(w).stem}"
        rows.append((label, w, r.box.map50, r.box.map, r.pose.map50, r.pose.map, cal))

    hdr = f"{'checkpoint':24s} {'boxAP50':>8} {'boxAP':>7} {'poseAP50':>9} {'poseAP':>7}"
    print("\n" + hdr)
    print("-" * len(hdr))
    for name, _w, b50, b, p50, p, _ in rows:
        print(f"{name:24s} {b50:8.3f} {b:7.3f} {p50:9.3f} {p:7.3f}")

    hdr2 = (f"{'checkpoint':24s} {'conf':>6} {'P':>6} {'R':>6} {'base px':>9} {'base p90':>9} "
            f"{'angle deg':>10} {'ang p90':>8} {'180 flip':>9} {'fp rate':>8}")
    print("\n" + hdr2)
    print("-" * len(hdr2))
    for name, _w, *_ , cal in rows:
        print(f"{name:24s} {cal.get('conf', 0):6.3f} {cal.get('precision', 0):6.3f} "
              f"{cal.get('recall', 0):6.3f} {cal.get('base_err_px_median', float('nan')):9.2f} "
              f"{cal.get('base_err_px_p90', float('nan')):9.2f} "
              f"{cal.get('angle_err_deg_median', float('nan')):10.2f} "
              f"{cal.get('angle_err_deg_p90', float('nan')):8.2f} "
              f"{cal.get('flipped_180_rate', 0):9.1%} "
              f"{cal.get('false_positive_rate_on_negatives', 0):8.4f}")

    n_gt = rows[0][-1].get("gt_instances", 0) if rows else 0
    print(f"\nval: {paths.dataset / 'images' / 'val'} (real crops only, {n_gt} instances)")
    if n_gt and n_gt < 100:
        print(f"NOTE: {n_gt} instances. Medians are trustworthy; p90 is roughly the "
              f"{max(1, round(n_gt * 0.1))}th worst case and moves a lot between runs.")

    if args.save and rows:
        # Rank on what we ship. mAP saturates here (fixed-size box -> fixed OKS tolerance),
        # so it cannot tell a good keypoint model from a great one.
        rows.sort(key=lambda r: (r[-1].get("base_err_px_median", 1e9),
                                 r[-1].get("angle_err_deg_median", 1e9)))
        label, w, *_, cal = rows[0]
        crop = json.loads((paths.dataset / "manifest.json").read_text())["crop"]
        save_json(paths.predict_config, {
            "weights": str(Path(w).resolve()), "crop": crop, "imgsz": imgsz,
            "conf": cal["conf"], "chosen_checkpoint": label, "calibration": cal,
        })
        print(f"\nsaved {paths.predict_config} -> {label}  (conf={cal['conf']:.3f})")


if __name__ == "__main__":
    main()
