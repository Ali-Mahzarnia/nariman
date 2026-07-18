"""Keypoint geometry and YOLO-pose label IO.

The label encodes exactly two things -- where the handle's base is, and which way the
handle points -- and **nothing about how much of the handle is visible**.

    kp0  base  -- the butt of the handle
    kp1  dir   -- a virtual point at a FIXED radius R from the base, along the handle axis

    base  = kp0
    angle = atan2(kp1 - kp0)

kp1 is not an anatomical landmark. You click somewhere along the handle and we project that
click onto the circle of radius R. A fully visible handle and one with 5 px poking past a
finger therefore produce identical labels, provided they point the same way.

The bounding box is a fixed-size square centered on the base. It does not depend on kp1 at
all. The earlier design padded the box by a fraction of the base-neck distance, which meant
an occluded handle -- the normal case -- got a smaller box than a visible one, and the
detector was handed two contradictory definitions of the same object.

Visibility follows COCO: 0 unlabeled, 1 labeled-but-occluded, 2 visible. A finger over the
base is `1`, not `0`. Ultralytics masks the keypoint loss on `v != 0`, so `1` is still
supervised -- which is the point: we want the network to infer a hidden base.
"""

from __future__ import annotations

import numpy as np

KPT_NAMES = ("base", "dir")
N_KPTS = len(KPT_NAMES)

V_UNLABELED = 0
V_OCCLUDED = 1
V_VISIBLE = 2

# Radius of the virtual direction point, in source-frame pixels. Crops are cut 1:1 from
# frames, so this is the same number in crop coordinates.
DIR_RADIUS_PX = 24.0

# Half-side of the base-centered box, as a multiple of R. 1.3 puts most of a ~46 px handle
# inside the box without the box ever depending on the handle.
BOX_HALF_FACTOR = 1.3


# kp1 used to be an anatomical "neck"; it is now a virtual direction point. Template files
# written before the rename still say "neck", and they mean the same click.
TEMPLATE_ALIASES = {"neck": "dir"}


def template_points_array(entry: dict) -> np.ndarray | None:
    """(2,2) array [base, dir] from a template_points.json entry, accepting the old key."""
    if not entry:
        return None
    e = {TEMPLATE_ALIASES.get(k, k): v for k, v in entry.items()}
    if "base" not in e or "dir" not in e:
        return None
    return np.array([e["base"], e["dir"]], np.float32)


def unit(v: np.ndarray) -> np.ndarray:
    n = float(np.hypot(v[0], v[1]))
    return np.array([1.0, 0.0], np.float32) if n < 1e-6 else (v / n).astype(np.float32)


def normalize_dir(base: np.ndarray, toward: np.ndarray, radius: float = DIR_RADIUS_PX) -> np.ndarray:
    """Project a click along the handle onto the fixed-radius circle around the base.

    This is what makes the label invariant to how much handle is visible.
    """
    base = np.asarray(base, np.float32)
    return (base + unit(np.asarray(toward, np.float32) - base) * radius).astype(np.float32)


def normalize_pair(kps: np.ndarray, radius: float = DIR_RADIUS_PX) -> np.ndarray:
    kps = np.asarray(kps, np.float32).reshape(-1, 2)
    return np.stack([kps[0], normalize_dir(kps[0], kps[1], radius)]).astype(np.float32)


def kpts_to_bbox(kps: np.ndarray, radius: float = DIR_RADIUS_PX) -> np.ndarray:
    """Fixed square centered on the base. Independent of kp1, and of occlusion."""
    kps = np.asarray(kps, np.float32).reshape(-1, 2)
    bx, by = kps[0]
    half = BOX_HALF_FACTOR * radius
    return np.array([bx - half, by - half, bx + half, by + half], np.float32)


def angle_deg(kps: np.ndarray) -> float:
    """Handle direction, degrees, measured base -> neck. Range (-180, 180]."""
    kps = np.asarray(kps, np.float32).reshape(-1, 2)
    d = kps[1] - kps[0]
    return float(np.degrees(np.arctan2(d[1], d[0])))


def angle_error_deg(a: float, b: float) -> float:
    """Smallest absolute difference between two directions, in degrees.

    Direction is signed (base -> neck), so 350 and 10 differ by 20, not 340. We do *not*
    fold by 180: telling the base from the tip is the whole point of using keypoints
    instead of an oriented box.
    """
    return abs((a - b + 180.0) % 360.0 - 180.0)


def clip_bbox(box: np.ndarray, w: int, h: int) -> np.ndarray:
    return np.array([max(0.0, box[0]), max(0.0, box[1]),
                     min(float(w - 1), box[2]), min(float(h - 1), box[3])], np.float32)


# ------------------------------------------------------------------ label IO


def write_pose_label(path, entries: list[tuple[np.ndarray, np.ndarray]], w: int, h: int,
                     radius: float = DIR_RADIUS_PX) -> None:
    """Write YOLO-pose lines: `cls cx cy bw bh  x0 y0 v0  x1 y1 v1` (all xy normalized).

    kp1 is re-projected onto the fixed-radius circle here, so no caller can accidentally
    write a length-dependent label. An empty entry list writes an empty file: a negative.
    """
    lines = []
    for kps, vis in entries:
        kps = normalize_pair(kps, radius)
        box = clip_bbox(kpts_to_bbox(kps, radius), w, h)
        cx, cy = (box[0] + box[2]) / 2 / w, (box[1] + box[3]) / 2 / h
        bw, bh = (box[2] - box[0]) / w, (box[3] - box[1]) / h
        parts = [f"0 {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}"]
        for (x, y), v in zip(kps, vis):
            parts.append(f"{np.clip(x / w, 0, 1):.6f} {np.clip(y / h, 0, 1):.6f} {int(v)}")
        lines.append(" ".join(parts))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + ("\n" if lines else ""))


def read_pose_label(path, w: int, h: int) -> list[tuple[np.ndarray, np.ndarray]]:
    """Return [(kpts_px (N,2), vis (N,))]. Empty list means a negative frame."""
    if not path.exists():
        return []
    out = []
    for line in path.read_text().strip().splitlines():
        p = line.split()
        if len(p) < 5 + 3 * N_KPTS:
            continue
        vals = np.array([float(v) for v in p[5:]], np.float32).reshape(-1, 3)
        kps = np.stack([vals[:, 0] * w, vals[:, 1] * h], axis=1)
        out.append((kps.astype(np.float32), vals[:, 2].astype(np.int32)))
    return out


def is_negative_pose(path) -> bool:
    return path.exists() and not path.read_text().strip()


def looks_like_pose_line(line: str) -> bool:
    """Distinguish a pose label from a segmentation polygon.

    Token count alone is not enough: a 5-vertex polygon is also 11 tokens. The tell is that
    pose visibility flags are integers (`2`) where a polygon carries normalized floats
    (`0.412345`) in the same slots.
    """
    t = line.split()
    if len(t) != 5 + 3 * N_KPTS:
        return False
    return all("." not in t[i] and t[i] in ("0", "1", "2") for i in range(7, len(t), 3))


def label_is_pose(path) -> bool:
    for line in path.read_text().strip().splitlines():
        return looks_like_pose_line(line)
    return False


def seed_from_polygon(poly_px: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Guess (base, dir) from a traced outline, for bootstrapping old labels.

    PCA gives the handle axis but not which end is the butt, so we break the tie on
    thickness: the handle is fatter than the blade. The guess is wrong often enough that
    the labeling tool has a one-key swap -- this is a seed, not an answer.
    """
    pts = np.asarray(poly_px, np.float32)
    c = pts.mean(axis=0)
    _, _, vt = np.linalg.svd(pts - c, full_matrices=False)
    axis = unit(vt[0])
    perp = np.array([-axis[1], axis[0]], np.float32)

    t = (pts - c) @ axis
    lo, hi = float(t.min()), float(t.max())
    end_a, end_b = c + axis * lo, c + axis * hi

    # Mean |perpendicular offset| near each end == local half-width.
    span = max(1e-6, hi - lo)
    near_a = pts[t < lo + 0.25 * span]
    near_b = pts[t > hi - 0.25 * span]
    wa = float(np.abs((near_a - c) @ perp).mean()) if len(near_a) else 0.0
    wb = float(np.abs((near_b - c) @ perp).mean()) if len(near_b) else 0.0

    base, toward = (end_a, end_b) if wa >= wb else (end_b, end_a)
    return normalize_pair(np.stack([base, toward])), np.array([V_VISIBLE, V_VISIBLE], np.int32)
