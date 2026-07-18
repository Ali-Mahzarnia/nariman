"""Crop extraction: the core of the pipeline.

The blade is ~36 px across in a 960x760 frame. Training on full frames at imgsz=640 shrinks
it to ~24 px -- about three cells on the stride-8 head. Instead we cut CROP x CROP windows
(default 320) and train at imgsz=640, a 2x upscale that puts ~72 px on the blade. That is
4x the pixels on target of a full-frame 640 run, at *less* compute than full-frame 960.

Inference crops the user's ROI the same way, so the model always sees the scale it trained
on -- and val metrics actually predict deployment behavior.
"""

from __future__ import annotations

import numpy as np

from .core import largest_polygon, polygons_to_mask

# A crop whose blade is less than this fraction visible is discarded entirely rather than
# labeled (would be a bad positive) or dropped (would be an unlabeled positive).
MIN_VISIBLE_FRACTION = 0.35
MIN_AREA_PX = 10.0


def clamp_window(
    cx: int,
    cy: int,
    size: int,
    w: int,
    h: int,
    bounds: tuple[int, int, int, int] | None = None,
) -> tuple[int, int, int, int]:
    """A size x size window centered near (cx, cy), shifted to stay inside the frame.

    `bounds` (x, y, w, h) confines the window to the letterbox content box. Without it,
    training crops sample the black bars -- 29% of these frames -- which inference crops
    never contain, so the model would spend capacity on a distribution it never meets.
    Bounds are ignored on an axis too small to hold the window.
    """
    lo_x, lo_y, hi_x, hi_y = 0, 0, max(0, w - size), max(0, h - size)
    if bounds is not None:
        bx, by, bw, bh = bounds
        if bw >= size:
            lo_x, hi_x = bx, bx + bw - size
        if bh >= size:
            lo_y, hi_y = by, by + bh - size
    x = int(np.clip(cx - size // 2, lo_x, max(lo_x, hi_x)))
    y = int(np.clip(cy - size // 2, lo_y, max(lo_y, hi_y)))
    return x, y, min(size, w), min(size, h)


def crop_with_polygons(
    img: np.ndarray,
    polys_px: list[np.ndarray],
    window: tuple[int, int, int, int],
) -> tuple[np.ndarray, list[np.ndarray]] | None:
    """Cut `window` out of `img` and clip each polygon to it.

    Clipping is done through a mask rather than analytic polygon intersection: it handles
    truncation and concavity for free, and re-contouring gives a polygon that matches the
    pixels the model will actually see.
    """
    x, y, cw, ch = window
    patch = img[y : y + ch, x : x + cw]
    if patch.shape[0] != ch or patch.shape[1] != cw:
        return None

    out: list[np.ndarray] = []
    for poly in polys_px:
        full = polygons_to_mask([poly], img.shape[0], img.shape[1])
        total = float((full > 0).sum())
        if total < MIN_AREA_PX:
            continue
        sub = full[y : y + ch, x : x + cw]
        visible = float((sub > 0).sum())
        if visible < MIN_AREA_PX:
            continue  # blade is outside this window; window stays a negative
        if visible < MIN_VISIBLE_FRACTION * total:
            return None  # a sliver: too ambiguous to label either way, drop the crop
        p = largest_polygon(sub, MIN_AREA_PX)
        if p is None:
            return None
        out.append(p)
    return patch, out


def positive_windows(
    poly_px: np.ndarray,
    size: int,
    w: int,
    h: int,
    n: int,
    rng: np.random.Generator,
    jitter: float = 0.32,
    bounds: tuple[int, int, int, int] | None = None,
) -> list[tuple[int, int, int, int]]:
    """Windows around one instance, jittered so the blade is not always centered.

    A model trained only on centered crops learns "the blade is in the middle", which is
    exactly wrong for an ROI the user drew by hand.
    """
    cx, cy = poly_px[:, 0].mean(), poly_px[:, 1].mean()
    out = []
    for _ in range(n):
        jx = rng.normal(0, jitter) * size
        jy = rng.normal(0, jitter) * size
        out.append(clamp_window(int(cx + jx), int(cy + jy), size, w, h, bounds))
    return out


def negative_windows(
    size: int,
    content: tuple[int, int, int, int],
    n: int,
    rng: np.random.Generator,
    avoid: np.ndarray | None = None,
    w: int = 0,
    h: int = 0,
) -> list[tuple[int, int, int, int]]:
    """Random windows inside the content box, optionally avoiding a labeled instance.

    `avoid` lets us harvest background crops from *positive* frames -- the same lighting
    and clutter as the blade, minus the blade. Those are the negatives that matter.
    """
    bx, by, bw, bh = content
    out: list[tuple[int, int, int, int]] = []
    tries = 0
    while len(out) < n and tries < n * 20:
        tries += 1
        cx = int(rng.integers(bx, bx + bw)) if bw > 1 else bx
        cy = int(rng.integers(by, by + bh)) if bh > 1 else by
        x, y, cw, ch = clamp_window(cx, cy, size, w or size, h or size, content)
        if avoid is not None and avoid[y : y + ch, x : x + cw].any():
            continue
        out.append((x, y, cw, ch))
    return out


def roi_to_window(roi: tuple[int, int, int, int], size: int, w: int, h: int) -> tuple[int, int, int, int]:
    """Turn a user ROI into the same kind of window the model trained on.

    If the ROI is smaller than `size` we expand it (keeping its center) so the blade lands
    at training scale. If it is bigger, the caller should tile -- see `tile_windows`.
    """
    x, y, rw, rh = roi
    return clamp_window(x + rw // 2, y + rh // 2, max(size, rw, rh), w, h)


def tile_windows(roi: tuple[int, int, int, int], size: int, overlap: float, w: int, h: int) -> list[tuple[int, int, int, int]]:
    """Cover an ROI larger than one crop with overlapping windows (SAHI-style)."""
    x, y, rw, rh = roi
    step = max(1, int(size * (1.0 - overlap)))
    xs = list(range(x, max(x + 1, x + rw - size + 1), step)) or [x]
    ys = list(range(y, max(y + 1, y + rh - size + 1), step)) or [y]
    if xs[-1] + size < x + rw:
        xs.append(x + rw - size)
    if ys[-1] + size < y + rh:
        ys.append(y + rh - size)
    seen, out = set(), []
    for wy in ys:
        for wx in xs:
            win = clamp_window(wx + size // 2, wy + size // 2, size, w, h)
            if win not in seen:
                seen.add(win)
                out.append(win)
    return out
