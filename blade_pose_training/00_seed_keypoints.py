"""Step 0 -- convert existing traced polygons into seed keypoint labels.

Run once, only if you already labeled frames with the old segmentation tool. Each polygon
is reduced to a base and a neck by taking its principal axis and calling the *fatter* end
the handle. That heuristic gets the axis roughly right and the *direction* wrong about half
the time, so every seeded frame must be reviewed: `02_browse_label.py --review` steps
through them, `w` swaps a flipped pair.

For an L-shaped blade the principal axis runs along the handle, so the seeded neck usually
lands past the handle/head junction. Drag it back to wherever you put the neck on the
template -- the two must mean the same anatomical point.

Polygons are preserved in `labels_poly/` and never touched again.
"""

from __future__ import annotations

import argparse
import shutil

import cv2
import numpy as np

from bladekit.core import denormalize, read_polygons, resolve_object, save_json
from bladekit.kpts import angle_deg, label_is_pose, seed_from_polygon, write_pose_label


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--force", action="store_true", help="Re-seed even if labels look like pose labels.")
    args = ap.parse_args()

    paths = resolve_object(args.object)
    backup = paths.root / "labels_poly"
    labels = sorted(paths.labels.glob("*.txt"))
    if not labels:
        raise SystemExit(f"No labels in {paths.labels}")

    already = [p for p in labels if p.read_text().strip() and label_is_pose(p)]
    if already and not args.force:
        raise SystemExit(f"{len(already)} label(s) already look like pose labels. Use --force to redo.")

    if not backup.exists():
        backup.mkdir(parents=True, exist_ok=True)
        for p in labels:
            shutil.copy2(p, backup / p.name)
        print(f"backed up {len(labels)} polygon labels -> {backup}")

    seeded = negatives = skipped = 0
    for lab in labels:
        src = backup / lab.name
        polys = read_polygons(src)
        if not polys:
            lab.write_text("")  # negative stays negative
            negatives += 1
            continue
        img = cv2.imread(str(paths.frames / f"{lab.stem}.jpg"))
        if img is None:
            skipped += 1
            continue
        h, w = img.shape[:2]

        entries = []
        for poly in polys:
            kps, vis = seed_from_polygon(denormalize(poly, w, h))
            entries.append((kps, vis))
        write_pose_label(lab, entries, w, h)
        seeded += 1

    save_json(paths.meta / "label_format.json", {"format": "pose", "kpts": ["base", "dir"]})
    print(f"\nseeded {seeded} positive frames, kept {negatives} negatives, skipped {skipped}")
    if seeded:
        angs = []
        for lab in labels:
            from bladekit.kpts import read_pose_label

            img = cv2.imread(str(paths.frames / f"{lab.stem}.jpg"))
            if img is None:
                continue
            for kps, _ in read_pose_label(lab, img.shape[1], img.shape[0]):
                angs.append(angle_deg(kps))
        if angs:
            a = np.array(angs)
            print(f"seeded angles: min={a.min():.0f} med={np.median(a):.0f} max={a.max():.0f} deg")
            spread = float(np.percentile(a, 90) - np.percentile(a, 10))
            if spread > 120:
                print(f"\nangles span {spread:.0f} deg across the p10-p90 range. If the grip is")
                print("consistent in your footage, that spread IS the flipped seeds showing up.")
            print("\nThe base/neck DIRECTION is a guess and is wrong roughly half the time.")
            print("Review every frame:  `w` swaps a flipped pair, `s` saves, `f` jumps to the next.")
            print("A flipped base is a 180 deg angle error, not a small one.")
    print(f"\nNext: python 02_browse_label.py --object {args.object} --video test.mp4 --review")


if __name__ == "__main__":
    main()
