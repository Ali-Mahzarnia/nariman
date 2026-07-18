"""Step 0b -- rewrite existing keypoint labels so they carry base + angle only.

The first version of the label put kp1 at an anatomical landmark (the handle/head junction)
and sized the bounding box from the base-to-kp1 distance. That made the label depend on how
much handle a finger left visible, which is precisely the wrong thing.

This rewrites every positive label so that

    kp1 = base + R * unit(kp1 - base)          R = DIR_RADIUS_PX
    box = fixed square centered on the base

The angle you clicked is preserved exactly -- only the radius changes -- so reviewed frames
stay reviewed. Idempotent: running it twice is a no-op.
"""

from __future__ import annotations

import argparse

import cv2
import numpy as np

from bladekit.core import resolve_object, save_json
from bladekit.kpts import (
    DIR_RADIUS_PX,
    angle_deg,
    angle_error_deg,
    is_negative_pose,
    read_pose_label,
    write_pose_label,
)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--radius", type=float, default=DIR_RADIUS_PX)
    args = ap.parse_args()

    paths = resolve_object(args.object)
    labels = sorted(paths.labels.glob("*.txt"))
    if not labels:
        raise SystemExit(f"No labels in {paths.labels}")

    changed = negatives = skipped = 0
    drift = []
    lengths_before = []
    for lab in labels:
        if is_negative_pose(lab):
            negatives += 1
            continue
        img = cv2.imread(str(paths.frames / f"{lab.stem}.jpg"))
        if img is None:
            skipped += 1
            continue
        h, w = img.shape[:2]
        entries = read_pose_label(lab, w, h)
        if not entries:
            skipped += 1
            continue

        before = [angle_deg(k) for k, _ in entries]
        lengths_before += [float(np.hypot(*(k[1] - k[0]))) for k, _ in entries]
        write_pose_label(lab, entries, w, h, args.radius)

        after = [angle_deg(k) for k, _ in read_pose_label(lab, w, h)]
        drift += [angle_error_deg(a, b) for a, b in zip(before, after)]
        changed += 1

    save_json(paths.meta / "label_format.json",
              {"format": "pose", "kpts": ["base", "dir"], "dir_radius_px": args.radius,
               "invariant": "label encodes base position and handle angle only"})

    print(f"normalized {changed} positive labels, {negatives} negatives, skipped {skipped}")
    if lengths_before:
        L = np.array(lengths_before)
        print(f"old base->kp1 length varied {L.min():.0f}..{L.max():.0f} px (median {np.median(L):.0f})")
        print(f"now every label uses a fixed radius of {args.radius:.0f} px")
    if drift:
        d = np.array(drift)
        print(f"angle drift from renormalizing: max {d.max():.4f} deg   <- must be ~0")
    print(f"\nNext: python 02_browse_label.py --object {args.object} --video test.mp4 --review")


if __name__ == "__main__":
    main()
