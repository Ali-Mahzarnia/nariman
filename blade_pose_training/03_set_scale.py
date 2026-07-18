"""Step 3 -- match the synthetic blade to the real one. One number.

This is what broke the old pipeline: it scaled the cutout to 10-45% of its own native
resolution, which has nothing to do with how big the blade looks in frame. The result was
synthetic blades ~77x larger in area than any real one.

The camera is fixed and the blade is one object, so there is exactly one size to set.
Resize the overlay until the yellow box matches a real blade, press `s`, done. A small
tolerance (+/- 12%) is added automatically -- not because the blade changes size, but
because its bounding box grows when it rotates and shrinks when a finger covers part of it.
Training adds its own scale jitter on top.

A green arrow marks any real labeled handle in the frame for reference.

Keys
  + / -            grow / shrink the overlay
  arrows           move the overlay
  r                new random rotation
  c                next cutout
  n / b            next / previous background frame
  s                save and quit          q  quit without saving
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

from bladekit.core import content_box, load_json, resolve_object, resolve_video, save_json
from bladekit.kpts import read_pose_label, template_points_array
from bladekit.synth import _build_object, _feather, _hard_diag
from bladekit.ui import KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_UP, draw_help, key_of

HELP = [
    "+/- resize   arrows move   r rotate   c next cutout   n/b frame",
    "s save+quit   q quit",
    "resize until the YELLOW BOX matches a real blade in this scene",
]

# The blade is one rigid object under a fixed camera, so there is one size. This tolerance
# absorbs the bbox growing with rotation and shrinking under occlusion -- not size variation.
SIZE_TOLERANCE = 0.12


def load_templates(paths):
    pts = load_json(paths.meta / "template_points.json")
    out = []
    for p in sorted(paths.cutouts.glob("*.png")):
        if p.name.endswith("_mask.png"):
            continue
        img = cv2.imread(str(p), cv2.IMREAD_UNCHANGED)
        if img is None or img.shape[2] != 4:
            continue
        out.append((p.name, img, template_points_array(pts.get(p.name))))
    if not out:
        raise SystemExit(f"No RGBA cutouts in {paths.cutouts}. Run 01_cut_template.py first.")
    if any(k is None for _, _, k in out):
        raise SystemExit(f"Some cutouts lack base/direction. Run 01b_template_points.py --object {paths.root.name}")
    return out


def real_blade_diags(paths) -> np.ndarray:
    """Apparent size of real blades, from the archived polygons.

    The pose label carries no size (that is the invariance), so the size reference has to
    come from `labels_poly/`, written once by 00_seed_keypoints.
    """
    poly_dir = paths.root / "labels_poly"
    if not poly_dir.exists():
        return np.zeros(0)
    from bladekit.core import denormalize, read_polygons

    diags = []
    for lab in sorted(poly_dir.glob("*.txt")):
        img = cv2.imread(str(paths.frames / f"{lab.stem}.jpg"))
        if img is None:
            continue
        h, w = img.shape[:2]
        for poly in read_polygons(lab):
            p = denormalize(poly, w, h)
            diags.append(float(np.hypot(np.ptp(p[:, 0]), np.ptp(p[:, 1]))))
    return np.array(diags) if diags else np.zeros(0)


def blit(frame, rgba, cx, cy):
    out = frame.copy()
    oh, ow = rgba.shape[:2]
    x, y = cx - ow // 2, cy - oh // 2
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(out.shape[1], x + ow), min(out.shape[0], y + oh)
    if x1 <= x0 or y1 <= y0:
        return out, (x, y)
    sx0, sy0 = x0 - x, y0 - y
    a = rgba[sy0 : sy0 + (y1 - y0), sx0 : sx0 + (x1 - x0), 3:4].astype(np.float32) / 255.0
    src = rgba[sy0 : sy0 + (y1 - y0), sx0 : sx0 + (x1 - x0), :3].astype(np.float32)
    dst = out[y0:y1, x0:x1].astype(np.float32)
    out[y0:y1, x0:x1] = np.clip(src * a + dst * (1 - a), 0, 255).astype(np.uint8)
    return out, (x, y)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--video", type=Path, default=None)
    ap.add_argument("--max-width", type=int, default=1400)
    args = ap.parse_args()

    paths = resolve_object(args.object)
    templates = load_templates(paths)
    lens = real_blade_diags(paths)
    if len(lens):
        print(f"real blade apparent size (bbox diagonal), {len(lens)} instances: "
              f"p5={np.percentile(lens,5):.0f}  med={np.median(lens):.0f}  p95={np.percentile(lens,95):.0f} px")
        print("aim for the overlay's bounding box to match that range")
    else:
        print("no size reference (labels_poly/ absent) -- set the range purely by eye")

    frames = sorted(paths.frames.glob("*.jpg"))
    cap = None
    if not frames:
        if args.video is None:
            raise SystemExit("No labeled frames yet. Pass --video to pick a background.")
        cap = cv2.VideoCapture(str(resolve_video(paths, args.video)))

    prev = load_json(paths.scale_file)
    # Start from the previously matched size if there is one, else the middle of the old range.
    diag = float(prev.get("matched_blade_px") or
                 (prev.get("diag_min_px", 28.0) + prev.get("diag_max_px", 56.0)) / 2)
    fi = ci = 0
    angle = 0.0
    pos = None
    win = "03 set scale"
    cv2.namedWindow(win)

    def background(i):
        if frames:
            p = frames[i % len(frames)]
            return cv2.imread(str(p)), p
        cap.set(cv2.CAP_PROP_POS_FRAMES, (i * 30) % max(1, int(cap.get(cv2.CAP_PROP_FRAME_COUNT))))
        ok, f = cap.read()
        return (f if ok else None), None

    while True:
        frame, fpath = background(fi)
        if frame is None:
            raise SystemExit("could not read a background frame")
        h, w = frame.shape[:2]
        if pos is None:
            bx, by, bw, bh = content_box(frame)
            pos = [bx + bw // 2, by + bh // 2]

        name, rgba, tk = templates[ci % len(templates)]
        # Exactly the object 04 will paste: same rotate/scale/flip and the same corrective
        # pass, so the size you judge here is the size that lands in the dataset.
        got = _build_object(rgba, tk, angle, diag, False)
        if got is None:
            diag = max(8.0, diag * 1.1)
            continue
        obj, kloc = got
        pasted_diag = _hard_diag(_feather(obj[:, :, 3]))

        composed, (ox, oy) = blit(frame, obj, pos[0], pos[1])
        kabs = kloc + np.array([ox, oy], np.float32)
        cv2.arrowedLine(composed, tuple(kabs[0].astype(int)), tuple(kabs[1].astype(int)),
                        (255, 255, 0), 2, cv2.LINE_AA, tipLength=0.2)

        # Box the blade's actual extent, so you compare like with like against the printed
        # real-blade diagonals rather than against a padded canvas.
        ys, xs = np.where(_feather(obj[:, :, 3]) >= 110)
        if ys.size:
            cv2.rectangle(composed, (ox + int(xs.min()), oy + int(ys.min())),
                          (ox + int(xs.max()), oy + int(ys.max())), (0, 255, 255), 1)

        has_real = False
        if fpath is not None:
            for kps, _ in read_pose_label(paths.labels / f"{fpath.stem}.txt", w, h):
                cv2.arrowedLine(composed, tuple(kps[0].astype(int)), tuple(kps[1].astype(int)),
                                (0, 255, 0), 2, cv2.LINE_AA, tipLength=0.2)
                has_real = True

        scale = min(1.0, args.max_width / w)
        view = cv2.resize(composed, (int(w * scale), int(h * scale))) if scale != 1.0 else composed
        ref = (f"real blades measure {np.percentile(lens,5):.0f}..{np.percentile(lens,95):.0f} px "
               f"(median {np.median(lens):.0f})") if len(lens) else "no real reference yet"
        draw_help(view, HELP + [
            f"YELLOW BOX = {pasted_diag:.0f} px        {ref}"
            + ("   green arrow = a real labeled handle" if has_real else ""),
            f"press s to save  ->  {pasted_diag * (1 - SIZE_TOLERANCE):.0f}..{pasted_diag * (1 + SIZE_TOLERANCE):.0f} px"
            f"        cutout {ci % len(templates) + 1}/{len(templates)}",
        ])
        cv2.imshow(win, view)

        code = cv2.waitKeyEx(20)
        if code == -1:
            continue
        if code in KEY_LEFT:
            pos[0] -= 4
        elif code in KEY_RIGHT:
            pos[0] += 4
        elif code in KEY_UP:
            pos[1] -= 4
        elif code in KEY_DOWN:
            pos[1] += 4
        else:
            k = key_of(code)
            if k in (ord("+"), ord("=")):
                diag = min(400.0, diag * 1.05)
            elif k in (ord("-"), ord("_")):
                diag = max(8.0, diag / 1.05)
            elif k == ord("r"):
                angle = float(np.random.uniform(-180, 180))
            elif k == ord("c"):
                ci += 1
            elif k == ord("n"):
                fi += 1
            elif k == ord("b"):
                fi = max(0, fi - 1)
            elif k == ord("s"):
                # `diag` is the cutout-canvas scale knob; `pasted_diag` is what the blade
                # actually measures once feathered and thresholded. Save the knob, but
                # derive the tolerance from the real thing so the numbers mean something.
                lo = diag * (1.0 - SIZE_TOLERANCE)
                hi = diag * (1.0 + SIZE_TOLERANCE)
                save_json(paths.scale_file, {
                    "diag_min_px": round(lo, 2),
                    "diag_max_px": round(hi, 2),
                    "matched_blade_px": round(pasted_diag, 2),
                    "tolerance": SIZE_TOLERANCE,
                    "real_blade_diag_px": None if not len(lens) else {
                        "n": int(len(lens)), "p5": round(float(np.percentile(lens, 5)), 2),
                        "median": round(float(np.median(lens)), 2),
                        "p95": round(float(np.percentile(lens, 95)), 2)},
                })
                print(f"\nmatched a real blade at {pasted_diag:.0f} px")
                print(f"saved {paths.scale_file}: {lo:.0f}..{hi:.0f} px "
                      f"(+/-{SIZE_TOLERANCE:.0%} for rotation and occlusion)")
                break
            elif k == ord("q"):
                print("not saved")
                break

    if cap:
        cap.release()
    cv2.destroyAllWindows()
    print(f"Next: python 04_build_dataset.py --object {args.object}")


if __name__ == "__main__":
    main()
