"""Step 4 -- build the crop dataset YOLO-pose trains on.

Composition, and why each part exists:

  real positive crops   jittered windows around each labeled handle. Jitter matters: a model
                        trained on centered crops learns "the blade is in the middle", which
                        is wrong for a hand-drawn ROI.
  hard background crops windows from *positive* frames that avoid the blade. Same lighting,
                        same clutter, no blade. These are the negatives that count.
  real negative crops   windows from frames you marked negative.
  synthetic crops       the traced cutout composited into negative frames only, at the size
                        you set in step 3. Its two keypoints ride through the same affine as
                        the pixels, so these labels are exact rather than estimated.
  mined negatives       false positives harvested by 07_mine_negatives.py, if any.

Validation is real crops only, split by contiguous time blocks so a frame's near-duplicate
twin cannot leak across.
"""

from __future__ import annotations

import argparse
import shutil
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np
import yaml

from bladekit.core import (
    content_box,
    load_json,
    load_scale,
    parse_frame_name,
    resolve_object,
    save_json,
)
from bladekit.crops import clamp_window, negative_windows, positive_windows
from bladekit.kpts import (
    DIR_RADIUS_PX,
    KPT_NAMES,
    N_KPTS,
    V_OCCLUDED,
    is_negative_pose,
    kpts_to_bbox,
    read_pose_label,
    template_points_array,
    write_pose_label,
)
from bladekit.synth import SynthConfig, finish_frame, place_one, prepare_template

# The base must sit far enough inside the crop that the fixed-radius direction point and the
# base-centered box both stay in bounds. Otherwise normalizing to [0,1] would clip kp1 and
# silently bend the angle -- the one quantity we ship.
EDGE_MARGIN_PX = DIR_RADIUS_PX * 1.35 + 2.0


def block_split(paths, val_fraction: float, block: int, seed: int) -> tuple[list[Path], list[Path]]:
    labeled = [p for p in sorted(paths.frames.glob("*.jpg")) if (paths.labels / f"{p.stem}.txt").exists()]
    if not labeled:
        raise SystemExit(f"No labeled frames in {paths.frames}. Run 02_browse_label.py first.")

    by_video: dict[str, list[Path]] = defaultdict(list)
    for p in labeled:
        by_video[parse_frame_name(p.stem)[0]].append(p)

    rng = np.random.default_rng(seed)
    train: list[Path] = []
    val: list[Path] = []
    for _, frames in sorted(by_video.items()):
        frames.sort(key=lambda p: parse_frame_name(p.stem)[1])
        blocks = [frames[i : i + block] for i in range(0, len(frames), block)]
        n_val = max(1, round(len(blocks) * val_fraction)) if len(blocks) > 2 else 0
        chosen = {int(i) for i in rng.permutation(len(blocks))[:n_val]}
        for i, blk in enumerate(blocks):
            (val if i in chosen else train).extend(blk)
    return sorted(train), sorted(val)


class Writer:
    def __init__(self, out: Path) -> None:
        self.out = out
        self.n = defaultdict(int)

    def add(self, split: str, kind: str, patch: np.ndarray, entries) -> None:
        i = self.n[(split, kind)]
        self.n[(split, kind)] += 1
        stem = f"{kind}_{i:05d}"
        h, w = patch.shape[:2]
        # The frame is already lossy from H.264; a second aggressive JPEG pass would soften
        # the handle edge before the model ever sees it.
        cv2.imwrite(str(self.out / "images" / split / f"{stem}.jpg"), patch,
                    [int(cv2.IMWRITE_JPEG_QUALITY), 96])
        write_pose_label(self.out / "labels" / split / f"{stem}.txt", entries, w, h)

    def count(self, split: str, kind: str) -> int:
        return self.n[(split, kind)]

    def total(self, split: str) -> int:
        return sum(v for (s, _), v in self.n.items() if s == split)


def load_templates(paths) -> list[tuple[np.ndarray, np.ndarray]]:
    """(rgba, template keypoints in cutout pixel coords)."""
    pts = load_json(paths.meta / "template_points.json")
    if not pts:
        raise SystemExit(
            f"No template points. Run:  python 01b_template_points.py --object {paths.root.name}"
        )
    out = []
    for p in sorted(paths.cutouts.glob("*.png")):
        if p.name.endswith("_mask.png"):
            continue
        img = cv2.imread(str(p), cv2.IMREAD_UNCHANGED)
        if img is None or img.ndim != 3 or img.shape[2] != 4:
            continue
        k = template_points_array(pts.get(p.name))
        if k is None:
            raise SystemExit(f"Cutout {p.name} has no base/direction. Run 01b_template_points.py.")
        out.append((img, k))
    if not out:
        raise SystemExit(f"No RGBA cutouts in {paths.cutouts}")
    return out


def crop_entries(entries, win) -> list | None:
    """Shift keypoints into crop coordinates. None means the crop is unusable."""
    x, y, cw, ch = win
    m = EDGE_MARGIN_PX
    out = []
    for kps, vis in entries:
        local = kps - np.array([x, y], np.float32)
        bx, by = local[0]
        if not (m <= bx < cw - m and m <= by < ch - m):
            return None  # base too near the edge: kp1 or the box would be clipped
        out.append((local, vis.copy()))
    return out


def emit_real(paths, writer, frames, split, crop, pos_crops, neg_crops, rng) -> None:
    for f in frames:
        img = cv2.imread(str(f))
        if img is None:
            continue
        h, w = img.shape[:2]
        entries = read_pose_label(paths.labels / f"{f.stem}.txt", w, h)
        box = content_box(img)

        if entries:
            for kps, _vis in entries:
                n = pos_crops if split == "train" else max(2, pos_crops // 3)
                for win in positive_windows(kps, crop, w, h, n, rng, bounds=box):
                    local = crop_entries(entries, win)
                    if not local:
                        continue
                    x, y, cw, ch = win
                    writer.add(split, "pos", img[y : y + ch, x : x + cw], local)

            avoid = np.zeros((h, w), np.uint8)
            for kps, _ in entries:
                b = kpts_to_bbox(kps).astype(int)
                cv2.rectangle(avoid, (b[0], b[1]), (b[2], b[3]), 255, -1)
            avoid = cv2.dilate(avoid, np.ones((crop // 3, crop // 3), np.uint8))
            for win in negative_windows(crop, box, neg_crops, rng, avoid, w, h):
                x, y, cw, ch = win
                writer.add(split, "bg", img[y : y + ch, x : x + cw], [])
        else:
            n = neg_crops + 1 if split == "train" else 2
            for win in negative_windows(crop, box, n, rng, None, w, h):
                x, y, cw, ch = win
                writer.add(split, "neg", img[y : y + ch, x : x + cw], [])


def emit_synthetic(paths, writer, neg_frames, templates, count, crop, cfg, centers, rng):
    """Returns (made, full_diag_px, visible_diag_px, occluded_base_count).

    Two size series. `full_diag` is the blade as pasted, before the cutter takes a slice; it
    is what the scale guard compares against real full-blade polygons. `visible_diag` is what
    survives the cut, and is only informative -- comparing *that* to a full polygon would
    make a correctly-sized synthetic look 30% too small.
    """
    if not neg_frames:
        raise SystemExit(
            "No negative frames to paste onto. Mark some with `x` in 02_browse_label.py.\n"
            "Synthetic blades go ONLY onto frames you confirmed hold no blade."
        )
    made = attempts = occ = 0
    full_diags: list[float] = []
    vis_diags: list[float] = []
    limit = count * 30
    while made < count and attempts < limit:
        attempts += 1
        bg = cv2.imread(str(neg_frames[int(rng.integers(0, len(neg_frames)))]))
        if bg is None:
            continue
        h, w = bg.shape[:2]
        canvas = bg.copy()
        box = content_box(bg)

        rgba, tkpts = templates[int(rng.integers(0, len(templates)))]
        pl = place_one(canvas, rgba, tkpts, box, rng, cfg, None, centers)
        if pl is None:
            continue

        img = finish_frame(canvas, rng, cfg)
        entries = [(pl.kpts, pl.visflags)]
        for win in positive_windows(pl.kpts, crop, w, h, 1, rng, bounds=box):
            local = crop_entries(entries, win)
            if not local:
                continue
            x, y, cw, ch = win
            writer.add("train", "synth", img[y : y + ch, x : x + cw], local)
            full_diags.append(pl.full_diag)
            vis_diags.append(pl.visible_diag)
            occ += int(pl.visflags[0] == V_OCCLUDED)
            made += 1
    return made, np.array(full_diags), np.array(vis_diags), occ


def emit_mined(paths, writer, crop) -> int:
    n = 0
    for p in sorted(paths.hard_negatives.glob("*.jpg")):
        img = cv2.imread(str(p))
        if img is None:
            continue
        if img.shape[0] != crop or img.shape[1] != crop:
            img = cv2.resize(img, (crop, crop))
        writer.add("train", "mined", img, [])
        n += 1
    return n


def real_blade_diags(paths, frames) -> np.ndarray:
    """Apparent size of real blades, from the archived polygons if they exist.

    The pose label deliberately carries no size. But the single most damaging bug in the old
    pipeline was synthetic blades 77x too large, so we keep a way to check. `labels_poly/`
    is written once by 00_seed_keypoints and never touched again.
    """
    poly_dir = paths.root / "labels_poly"
    if not poly_dir.exists():
        return np.zeros(0)
    from bladekit.core import denormalize, read_polygons

    diags = []
    for f in frames:
        img = cv2.imread(str(f))
        if img is None:
            continue
        h, w = img.shape[:2]
        for poly in read_polygons(poly_dir / f"{f.stem}.txt"):
            p = denormalize(poly, w, h)
            diags.append(float(np.hypot(np.ptp(p[:, 0]), np.ptp(p[:, 1]))))
    return np.array(diags)


def real_centers(paths, frames) -> np.ndarray:
    pts = []
    for f in frames:
        img = cv2.imread(str(f))
        if img is None:
            continue
        h, w = img.shape[:2]
        for kps, _ in read_pose_label(paths.labels / f"{f.stem}.txt", w, h):
            c = kps.mean(axis=0)
            pts.append([c[0] / w, c[1] / h])
    return np.array(pts, np.float32) if pts else np.zeros((0, 2), np.float32)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--crop", type=int, default=320)
    ap.add_argument("--synthetic", type=int, default=900)
    ap.add_argument("--pos-crops", type=int, default=6)
    ap.add_argument("--neg-crops", type=int, default=3)
    ap.add_argument("--val-fraction", type=float, default=0.22)
    ap.add_argument("--block", type=int, default=6)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    paths = resolve_object(args.object)
    scale = load_scale(paths)
    cfg = SynthConfig(diag_min=scale["diag_min_px"], diag_max=scale["diag_max_px"])
    templates = [prepare_template(r, k, cfg.diag_max) for r, k in load_templates(paths)]
    rng = np.random.default_rng(args.seed)

    out = paths.dataset
    if out.exists():
        shutil.rmtree(out)
    for split in ("train", "val"):
        (out / "images" / split).mkdir(parents=True, exist_ok=True)
        (out / "labels" / split).mkdir(parents=True, exist_ok=True)

    train_frames, val_frames = block_split(paths, args.val_fraction, args.block, args.seed)
    tr_pos = [f for f in train_frames if not is_negative_pose(paths.labels / f"{f.stem}.txt")]
    tr_neg = [f for f in train_frames if is_negative_pose(paths.labels / f"{f.stem}.txt")]
    va_pos = [f for f in val_frames if not is_negative_pose(paths.labels / f"{f.stem}.txt")]

    print(f"crop={args.crop}px   synthetic scale = {cfg.diag_min:.0f}..{cfg.diag_max:.0f} px diagonal")
    print(f"frames: train {len(tr_pos)} pos / {len(tr_neg)} neg    val {len(va_pos)} pos / {len(val_frames) - len(va_pos)} neg")

    writer = Writer(out)
    emit_real(paths, writer, train_frames, "train", args.crop, args.pos_crops, args.neg_crops, rng)
    emit_real(paths, writer, val_frames, "val", args.crop, args.pos_crops, args.neg_crops, rng)
    n_synth, synth_diags, synth_vis_diags, n_occ = emit_synthetic(
        paths, writer, tr_neg, templates, args.synthetic, args.crop, cfg,
        real_centers(paths, tr_pos), rng)
    n_mined = emit_mined(paths, writer, args.crop)

    real_diags = real_blade_diags(paths, train_frames)

    data = {
        "path": str(out),
        "train": "images/train",
        "val": "images/val",
        "names": {0: "blade"},
        "kpt_shape": [N_KPTS, 3],
        # base and direction are distinct semantic points, not a left/right pair, so a
        # horizontal flip must not swap them.
        "flip_idx": list(range(N_KPTS)),
    }
    (out / "data.yaml").write_text(yaml.safe_dump(data, sort_keys=False))

    stats = {}
    if len(synth_diags):
        stats["synth_blade_diag_px"] = {
            "p5": round(float(np.percentile(synth_diags, 5)), 1),
            "median": round(float(np.median(synth_diags)), 1),
            "p95": round(float(np.percentile(synth_diags, 95)), 1)}
    if len(synth_vis_diags):
        stats["synth_visible_diag_px"] = {
            "median": round(float(np.median(synth_vis_diags)), 1)}
    if len(real_diags):
        stats["real_blade_diag_px"] = {
            "p5": round(float(np.percentile(real_diags, 5)), 1),
            "median": round(float(np.median(real_diags)), 1),
            "p95": round(float(np.percentile(real_diags, 95)), 1)}

    save_json(out / "manifest.json", {
        "task": "pose",
        "crop": args.crop,
        "kpt_names": list(KPT_NAMES),
        "dir_radius_px": DIR_RADIUS_PX,
        "label_invariant": "base position + handle angle only",
        "scale_px": {"min": cfg.diag_min, "max": cfg.diag_max},
        "train": {k: writer.count("train", k) for k in ("pos", "bg", "neg", "synth", "mined")},
        "val": {k: writer.count("val", k) for k in ("pos", "bg", "neg")},
        "synth_occluded_base": n_occ,
        "val_is_real_only": True,
        "seed": args.seed,
        "templates": len(templates),
        **stats,
    })

    print(f"\ntrain crops: pos={writer.count('train','pos')} bg={writer.count('train','bg')} "
          f"neg={writer.count('train','neg')} synth={n_synth} mined={n_mined}  total={writer.total('train')}")
    print(f"val crops:   pos={writer.count('val','pos')} bg={writer.count('val','bg')} "
          f"neg={writer.count('val','neg')}  total={writer.total('val')}  (real only)")
    print(f"\nsynthetic samples whose base a cut buried: {n_occ}/{n_synth} "
          f"({n_occ / max(1, n_synth):.0%}) -- these are the ones real footage cannot give you")

    if len(synth_diags) and len(real_diags):
        # Your traced polygons follow the blade you could SEE -- a finger already hid part of
        # most of them. The network also only ever sees visible pixels. So the verdict
        # compares visible-to-visible. The pre-cut size is printed for context: it should sit
        # above the real median, because a real blade's true extent exceeds what you traced.
        real_med = float(np.median(real_diags))
        vis_med = float(np.median(synth_vis_diags)) if len(synth_vis_diags) else float(np.median(synth_diags))
        ratio = vis_med / max(1e-6, real_med)
        verdict = "OK" if 0.7 <= ratio <= 1.4 else "*** MISMATCH -- redo 03_set_scale.py ***"

        print("\nblade apparent size (bbox diagonal, px)")
        print(f"  real, as traced (visible extent)   p5={np.percentile(real_diags,5):5.0f} "
              f"med={real_med:5.0f}  p95={np.percentile(real_diags,95):5.0f}")
        print(f"  synth, as pasted (whole blade)     p5={np.percentile(synth_diags,5):5.0f} "
              f"med={np.median(synth_diags):5.0f}  p95={np.percentile(synth_diags,95):5.0f}")
        if len(synth_vis_diags):
            print(f"  synth, after the cutter (visible)  "
                  f"p5={np.percentile(synth_vis_diags,5):5.0f} med={vis_med:5.0f}  "
                  f"p95={np.percentile(synth_vis_diags,95):5.0f}")
        print(f"\n  visible/visible ratio = {ratio:.2f}   {verdict}")
        if ratio < 0.7:
            need = np.array([cfg.diag_min, cfg.diag_max]) / ratio
            print(f"  -> synthetics are too small. Re-run 03 and set MIN/MAX near "
                  f"{need[0]:.0f}/{need[1]:.0f} px.")
        elif ratio > 1.4:
            need = np.array([cfg.diag_min, cfg.diag_max]) / ratio
            print(f"  -> synthetics are too big. Re-run 03 and set MIN/MAX near "
                  f"{need[0]:.0f}/{need[1]:.0f} px.")

    print(f"\ndata.yaml: {out / 'data.yaml'}")
    print(f"Next: python 05_inspect.py --object {args.object}   <- LOOK AT THE SHEETS")


if __name__ == "__main__":
    main()
