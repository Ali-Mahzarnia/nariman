"""Step 5 -- look at the dataset before spending hours training on it.

Writes contact sheets to `qc/` and prints a size check comparing synthetic handles against
real ones. If those two distributions do not overlap, nothing downstream can save you --
that single defect is what capped the previous pipeline.
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import cv2
import numpy as np

from bladekit.kpts import KPT_NAMES, V_OCCLUDED, angle_deg, kpts_to_bbox, read_pose_label
from bladekit.core import resolve_object

ZOOM = 2
COL = {"base": (0, 220, 255), "dir": (255, 160, 0)}


def sheet(images: list[Path], labels: Path, out_path: Path, title: str, cols: int = 4) -> None:
    tiles = []
    for p in images:
        img = cv2.imread(str(p))
        if img is None:
            continue
        h, w = img.shape[:2]
        img = cv2.resize(img, (w * ZOOM, h * ZOOM), interpolation=cv2.INTER_NEAREST)
        for kps, vis in read_pose_label(labels / f"{p.stem}.txt", w, h):
            k = kps * ZOOM
            cv2.arrowedLine(img, tuple(k[0].astype(int)), tuple(k[1].astype(int)),
                            (0, 255, 0), 2, cv2.LINE_AA, tipLength=0.15)
            b = (kpts_to_bbox(kps) * ZOOM).astype(int)
            cv2.rectangle(img, (b[0], b[1]), (b[2], b[3]), (0, 160, 0), 1)
            for i, name in enumerate(KPT_NAMES):
                c = tuple(k[i].astype(int))
                if vis[i] == V_OCCLUDED:
                    cv2.circle(img, c, 6, COL[name], 2)
                else:
                    cv2.circle(img, c, 5, COL[name], -1)
        cv2.putText(img, p.stem, (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1, cv2.LINE_AA)
        cv2.rectangle(img, (0, 0), (img.shape[1] - 1, img.shape[0] - 1), (60, 60, 60), 1)
        tiles.append(img)

    if not tiles:
        return
    while len(tiles) % cols:
        tiles.append(np.zeros_like(tiles[0]))
    grid = np.vstack([np.hstack(tiles[i : i + cols]) for i in range(0, len(tiles), cols)])
    banner = np.zeros((34, grid.shape[1], 3), np.uint8)
    cv2.putText(banner, title, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), np.vstack([banner, grid]))
    print(f"wrote {out_path}")


def stats(labels: Path, pattern: str, crop: int):
    """Angles and occluded-base counts. Lengths are meaningless now -- kp1 sits at a fixed
    radius by construction, which is the whole point of the label being invariant."""
    angs, occ, n = [], 0, 0
    for f in labels.glob(pattern):
        for kps, vis in read_pose_label(f, crop, crop):
            angs.append(angle_deg(kps))
            occ += int(vis[0] == V_OCCLUDED)
            n += 1
    return np.array(angs), occ, n


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--n", type=int, default=12)
    ap.add_argument("--seed", type=int, default=3)
    args = ap.parse_args()

    paths = resolve_object(args.object)
    ds = paths.dataset
    if not (ds / "data.yaml").exists():
        raise SystemExit(f"No dataset at {ds}. Run 04_build_dataset.py first.")
    crop = json.loads((ds / "manifest.json").read_text())["crop"]
    tl = ds / "labels" / "train"
    rng = random.Random(args.seed)

    for kind, title in (("synth", "SYNTHETIC train crops (green arrow = base -> direction)"),
                        ("pos", "REAL positive train crops"),
                        ("bg", "HARD background crops (positive frames, handle avoided)"),
                        ("neg", "REAL negative crops")):
        imgs = sorted((ds / "images" / "train").glob(f"{kind}_*.jpg"))
        if imgs:
            sheet(rng.sample(imgs, min(args.n, len(imgs))), tl, paths.qc / f"{kind}.png", title)

    ra, rocc, rn = stats(tl, "pos_*.txt", crop)
    sa, socc, sn = stats(tl, "synth_*.txt", crop)

    manifest = json.loads((ds / "manifest.json").read_text())
    rd = manifest.get("real_blade_diag_px")
    sd = manifest.get("synth_blade_diag_px")
    sv = manifest.get("synth_visible_diag_px")
    print("\n--- apparent blade size (guard against the old 77x scale bug) ---")
    if rd and sd:
        # Your polygons traced the blade you could SEE, and the network only sees visible
        # pixels. So the verdict compares visible-to-visible, exactly as 04 does. Judging the
        # whole pasted blade against a part-occluded trace would flag a correct dataset.
        vis_med = (sv or sd)["median"]
        ratio = vis_med / max(1e-6, rd["median"])
        verdict = "OK" if 0.7 <= ratio <= 1.4 else "*** MISMATCH -- redo 03_set_scale.py ***"
        print(f"real,  as traced (visible)  p5={rd['p5']:5.0f} med={rd['median']:5.0f} p95={rd['p95']:5.0f} px")
        print(f"synth, as pasted (whole)    p5={sd['p5']:5.0f} med={sd['median']:5.0f} p95={sd['p95']:5.0f} px")
        if sv:
            print(f"synth, after the cutter     {'':>10} med={sv['median']:5.0f}")
        print(f"visible/visible ratio = {ratio:.2f}   {verdict}")
    else:
        print("no archived polygons to compare against (labels_poly/ absent) -- judge by eye")

    print("\n--- angle coverage (base -> direction, deg) ---")
    if len(ra):
        print(f"real      n={rn:5d}  range {ra.min():7.1f} .. {ra.max():7.1f}   occluded base: {rocc}")
    if len(sa):
        print(f"synthetic n={sn:5d}  range {sa.min():7.1f} .. {sa.max():7.1f}   occluded base: {socc} "
              f"({socc / max(1, sn):.0%})")
    if len(ra) and len(sa) and (ra.max() - ra.min()) < 90:
        print("\nreal angles span a narrow band; synthetic covers the full circle, which is what\n"
              "keeps the model honest if the grip ever changes.")
    if len(sa) and socc == 0:
        print("\nWARNING: no synthetic sample has an occluded base. The cutter is not firing,\n"
              "and those are the samples real footage cannot give you.")

    print(f"\nsheets in {paths.qc}. Look at them, then:")
    print(f"  python 06_train.py --object {args.object}")


if __name__ == "__main__":
    main()
