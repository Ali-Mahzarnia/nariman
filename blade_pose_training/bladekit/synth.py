"""Composite a traced blade cutout into real negative frames.

Only frames you explicitly marked negative are used as backgrounds. That removes, by
construction, the failure that crippled the previous pipeline: pasting onto frames whose
own real blade was unlabeled, which taught the model that real blades are background.

Everything else here exists to stop the model from learning "sticker" cues instead of
blade cues -- feathered alpha, colors bled outward before downscaling, local illumination
matching, motion blur, defocus, shadow, sensor noise, JPEG recompression.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .kpts import V_OCCLUDED, V_VISIBLE, normalize_pair

MIN_VISIBLE_FRACTION = 0.45
MIN_INSTANCE_AREA_PX = 10.0

# The base lies on the blade's silhouette edge, so a single-pixel visibility probe is at the
# mercy of the alpha ramp and any motion blur. Ask whether the base's neighbourhood survived.
BASE_PROBE_RADIUS = 2


@dataclass
class SynthConfig:
    diag_min: float = 28.0
    diag_max: float = 52.0
    truncate_prob: float = 0.28
    occlude_prob: float = 0.25
    # A finger slicing across the handle. Half of those cuts bury the base itself, which is
    # the case real footage rarely labels and the model most needs.
    cut_prob: float = 0.45
    cut_hides_base_prob: float = 0.5
    shadow_prob: float = 0.65
    motion_blur_prob: float = 0.55
    prior_prob: float = 0.60
    prior_jitter: float = 0.06
    max_motion_blur: int = 5
    max_defocus_sigma: float = 1.1
    harmonize_strength: tuple[float, float] = (0.20, 0.50)
    noise_sigma: tuple[float, float] = (0.8, 3.5)
    jpeg_quality: tuple[int, int] = (62, 94)
    occlusion_range: tuple[float, float] = (0.08, 0.55)

    def sample_diag(self, rng: np.random.Generator) -> float:
        return float(np.exp(rng.uniform(np.log(self.diag_min), np.log(self.diag_max))))


def _rotate_rgba(rgba: np.ndarray, angle: float) -> np.ndarray:
    h, w = rgba.shape[:2]
    mat = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), angle, 1.0)
    cos, sin = abs(mat[0, 0]), abs(mat[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    mat[0, 2] += nw / 2.0 - w / 2.0
    mat[1, 2] += nh / 2.0 - h / 2.0
    return cv2.warpAffine(rgba, mat, (nw, nh), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))


def _tight_crop(rgba: np.ndarray) -> np.ndarray:
    ys, xs = np.where(rgba[:, :, 3] > 8)
    if ys.size == 0:
        return rgba
    return rgba[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def _bleed_edges(rgba: np.ndarray, iterations: int = 3) -> np.ndarray:
    """Push object color into the transparent border before any downscale.

    Transparent pixels carry BGR (0,0,0); interpolating them into the rim leaves a dark
    halo that is a perfect "this was pasted" cue.
    """
    bgr, alpha = rgba[:, :, :3].copy(), rgba[:, :, 3]
    hole = (alpha < 8).astype(np.uint8)
    if hole.sum() == 0:
        return rgba
    k = np.ones((3, 3), np.uint8)
    for _ in range(iterations):
        dil = cv2.dilate(bgr, k)
        m = (hole > 0) & (bgr.max(axis=2) == 0)
        bgr[m] = dil[m]
    return np.dstack([bgr, alpha])


def _resize_to_diag(rgba: np.ndarray, target: float) -> np.ndarray | None:
    h, w = rgba.shape[:2]
    cur = float(np.hypot(w, h))
    if cur < 1e-6:
        return None
    s = target / cur
    nw, nh = max(3, round(w * s)), max(3, round(h * s))
    interp = cv2.INTER_AREA if s < 1.0 else cv2.INTER_CUBIC
    return cv2.resize(rgba, (nw, nh), interpolation=interp)


def _motion_kernel(length: int, angle: float) -> np.ndarray:
    k = np.zeros((length, length), np.float32)
    k[length // 2, :] = 1.0
    mat = cv2.getRotationMatrix2D((length / 2 - 0.5, length / 2 - 0.5), angle, 1.0)
    k = cv2.warpAffine(k, mat, (length, length))
    t = k.sum()
    return k / t if t > 0 else k


def _harmonize(bgr: np.ndarray, alpha: np.ndarray, bg_patch: np.ndarray, strength: float) -> np.ndarray:
    """Adapt to local illumination without repainting the object.

    Matching mean+std on all three LAB channels turned a blue blade beige on a beige wall.
    Luminance gets a real shift with a clamped contrast ratio; chroma gets a token nudge.
    """
    m = alpha > 32
    if m.sum() < 4 or bg_patch.size == 0:
        return bgr
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    bg = cv2.cvtColor(bg_patch, cv2.COLOR_BGR2LAB).astype(np.float32)

    o = lab[:, :, 0]
    om, osd = o[m].mean(), o[m].std() + 1e-6
    bm, bsd = bg[:, :, 0].mean(), bg[:, :, 0].std() + 1e-6
    ratio = float(np.clip(bsd / osd, 0.85, 1.18))
    lab[:, :, 0] = np.clip(o * (1 - strength) + ((o - om) * ratio + bm) * strength, 0, 255)

    for c in (1, 2):
        o = lab[:, :, c]
        lab[:, :, c] = np.clip(o + strength * 0.12 * (bg[:, :, c].mean() - o[m].mean()), 0, 255)
    return cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2BGR)


def _paste(canvas: np.ndarray, bgr: np.ndarray, alpha: np.ndarray, x: int, y: int) -> np.ndarray:
    ch, cw = canvas.shape[:2]
    oh, ow = alpha.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(cw, x + ow), min(ch, y + oh)
    vis = np.zeros((ch, cw), np.uint8)
    if x1 <= x0 or y1 <= y0:
        return vis
    sx0, sy0 = x0 - x, y0 - y
    sx1, sy1 = sx0 + (x1 - x0), sy0 + (y1 - y0)
    a = (alpha[sy0:sy1, sx0:sx1].astype(np.float32) / 255.0)[..., None]
    src = bgr[sy0:sy1, sx0:sx1].astype(np.float32)
    dst = canvas[y0:y1, x0:x1].astype(np.float32)
    canvas[y0:y1, x0:x1] = np.clip(src * a + dst * (1 - a), 0, 255).astype(np.uint8)
    vis[y0:y1, x0:x1] = (alpha[sy0:sy1, sx0:sx1] >= 110).astype(np.uint8) * 255
    return vis


def _shadow(canvas: np.ndarray, alpha: np.ndarray, x: int, y: int, rng: np.random.Generator) -> None:
    dx, dy = int(rng.integers(-3, 4)), int(rng.integers(1, 5))
    blur = int(rng.integers(2, 6)) * 2 + 1
    sh = cv2.GaussianBlur(alpha, (blur, blur), 0).astype(np.float32) / 255.0
    strength = float(rng.uniform(0.12, 0.32))
    ch, cw = canvas.shape[:2]
    oh, ow = alpha.shape[:2]
    sx, sy = x + dx, y + dy
    x0, y0 = max(0, sx), max(0, sy)
    x1, y1 = min(cw, sx + ow), min(ch, sy + oh)
    if x1 <= x0 or y1 <= y0:
        return
    s = sh[y0 - sy : y1 - sy, x0 - sx : x1 - sx][..., None]
    region = canvas[y0:y1, x0:x1].astype(np.float32)
    canvas[y0:y1, x0:x1] = np.clip(region * (1 - strength * s), 0, 255).astype(np.uint8)


def _sample_patch(src, box, forbid, pw, ph, rng) -> np.ndarray | None:
    """Lift a blade-free patch from inside the content box (never from a letterbox bar)."""
    bx, by, bw, bh = box
    if bw <= pw or bh <= ph:
        return None
    for _ in range(12):
        sx = int(rng.integers(bx, bx + bw - pw))
        sy = int(rng.integers(by, by + bh - ph))
        if forbid[sy : sy + ph, sx : sx + pw].any():
            continue
        return src[sy : sy + ph, sx : sx + pw].copy()
    return None


def _cut(canvas, vis, src, box, forbid, rng, cfg, base, direction) -> np.ndarray:
    """Slice the blade with a line perpendicular to the handle and erase one side.

    This is the finger. A fully visible blade and a blade whose base is buried in a fist
    must produce the same label, so we generate both -- and when the cut removes the base
    side, the base keypoint stays labeled (as occluded) because we know exactly where we
    put it. That is the sample the model needs and no amount of real footage gives cheaply.
    """
    ys, xs = np.where(vis > 0)
    if ys.size == 0:
        return vis
    before = float((vis > 0).sum())

    pts = np.stack([xs, ys], axis=1).astype(np.float32)
    u = direction / (np.linalg.norm(direction) + 1e-9)
    t = (pts - base) @ u
    lo, hi = float(t.min()), float(t.max())
    if hi - lo < 4:
        return vis

    # Where along the handle does the finger sit, and which side does it hide?
    cut_t = lo + (hi - lo) * float(rng.uniform(0.2, 0.8))
    keep_far = rng.random() < cfg.cut_hides_base_prob  # True => erase the base side
    doomed = (t > cut_t) if not keep_far else (t < cut_t)

    kill = np.zeros_like(vis)
    kill[ys[doomed], xs[doomed]] = 255
    kill = cv2.dilate(kill, np.ones((2, 2), np.uint8))
    remaining = float(((vis > 0) & (kill == 0)).sum())
    if remaining < max(MIN_INSTANCE_AREA_PX, 0.15 * before):
        return vis  # nothing recognisable would be left

    ky, kx = np.where(kill > 0)
    x0, x1 = int(kx.min()), int(kx.max()) + 1
    y0, y1 = int(ky.min()), int(ky.max()) + 1
    patch = _sample_patch(src, box, forbid, x1 - x0, y1 - y0, rng)
    if patch is None:
        return vis

    m = (kill[y0:y1, x0:x1] > 0)
    region = canvas[y0:y1, x0:x1]
    region[m] = patch[m]
    # A hard silhouette edge would be a giveaway; the real occluder has a soft boundary.
    blur = cv2.GaussianBlur(canvas[y0:y1, x0:x1], (3, 3), 0)
    edge = cv2.dilate(m.astype(np.uint8), np.ones((3, 3), np.uint8)) & (~m).astype(np.uint8)
    region[edge > 0] = blur[edge > 0]

    vis[kill > 0] = 0
    return vis


def _occlude(canvas, vis, src, box, forbid, rng, cfg) -> np.ndarray:
    """Cover part of the blade with background, approximating a hand passing in front."""
    ys, xs = np.where(vis > 0)
    if ys.size == 0:
        return vis
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    before = float((vis > 0).sum())
    pw = max(4, int((x1 - x0 + 1) * rng.uniform(0.35, 0.8)))
    ph = max(4, int((y1 - y0 + 1) * rng.uniform(0.35, 0.8)))
    cx, cy = int(rng.integers(x0, x1 + 1)), int(rng.integers(y0, y1 + 1))
    px = int(np.clip(cx - pw // 2, 0, canvas.shape[1] - pw))
    py = int(np.clip(cy - ph // 2, 0, canvas.shape[0] - ph))

    patch = _sample_patch(src, box, forbid, pw, ph, rng)
    if patch is None:
        return vis

    blob = np.zeros((ph, pw), np.uint8)
    cv2.ellipse(blob, (pw // 2, ph // 2), (max(2, pw // 2), max(2, ph // 2)),
                float(rng.uniform(0, 180)), 0, 360, 255, -1)
    blob = cv2.GaussianBlur(blob, (3, 3), 0)

    covered = ((blob > 128) & (vis[py : py + ph, px : px + pw] > 0)).sum()
    lo, hi = cfg.occlusion_range
    if not (lo <= covered / max(1.0, before) <= hi):
        return vis

    a = (blob.astype(np.float32) / 255.0)[..., None]
    region = canvas[py : py + ph, px : px + pw].astype(np.float32)
    canvas[py : py + ph, px : px + pw] = np.clip(patch * a + region * (1 - a), 0, 255).astype(np.uint8)
    vis[py : py + ph, px : px + pw][blob > 128] = 0
    return vis


@dataclass
class Placement:
    """One composited blade: its visible mask, its keypoints, and their visibility."""

    vis: np.ndarray  # uint8 mask on the full canvas, AFTER cutting/occlusion
    kpts: np.ndarray  # (N, 2) absolute canvas coordinates
    visflags: np.ndarray  # (N,) 1 = occluded, 2 = visible
    # Bounding-box diagonal of the blade as pasted, BEFORE any cut. The scale guard must
    # compare this against real full-blade polygons; measuring the post-cut mask would make
    # correctly-sized synthetics look too small and send you off tuning the wrong knob.
    full_diag: float = 0.0
    visible_diag: float = 0.0


def _transform_template(
    rgba: np.ndarray,
    kpts: np.ndarray,
    angle: float,
    target_diag: float,
    flip: bool,
) -> tuple[np.ndarray, np.ndarray] | None:
    """Rotate / crop / scale / flip the cutout, carrying its keypoints through the same
    transform. This is the whole reason synthetic labels are exact rather than estimated."""
    h, w = rgba.shape[:2]
    mat = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), angle, 1.0)
    cos, sin = abs(mat[0, 0]), abs(mat[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    mat[0, 2] += nw / 2.0 - w / 2.0
    mat[1, 2] += nh / 2.0 - h / 2.0
    rot = cv2.warpAffine(rgba, mat, (nw, nh), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))
    pts = (mat @ np.hstack([kpts, np.ones((len(kpts), 1))]).T).T.astype(np.float32)

    ys, xs = np.where(rot[:, :, 3] > 8)
    if ys.size == 0:
        return None
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    obj = _bleed_edges(rot[y0:y1, x0:x1])
    pts -= np.array([x0, y0], np.float32)

    ch, cw = obj.shape[:2]
    s = target_diag / float(np.hypot(cw, ch))
    nw2, nh2 = max(3, round(cw * s)), max(3, round(ch * s))
    interp = cv2.INTER_AREA if s < 1.0 else cv2.INTER_CUBIC
    obj = cv2.resize(obj, (nw2, nh2), interpolation=interp)
    pts *= np.array([nw2 / cw, nh2 / ch], np.float32)

    if flip:
        obj = cv2.flip(obj, 1)
        pts[:, 0] = (nw2 - 1) - pts[:, 0]
    return obj, pts


def _feather(alpha: np.ndarray) -> np.ndarray:
    """Soften the silhouette edge without making the blade translucent.

    A hard 0 -> 255 alpha jump is a cut-paper edge the model can key on, so the rim wants a
    ~1-2 px ramp. But this blade is ~10 px wide at working scale: eroding a pixel and
    blurring drove the *interior* alpha to a mean of 221, so the background bled through the
    whole object. The blade is opaque. Only its rim is soft, and the core is restored to 255
    after blurring.
    """
    h, w = alpha.shape[:2]
    if min(h, w) < 30:  # small object: blur only, an erode would eat it
        soft = cv2.GaussianBlur(alpha, (3, 3), 0.5)
    else:
        soft = cv2.GaussianBlur(cv2.erode(alpha, np.ones((2, 2), np.uint8)), (3, 3), 0.8)
    # Restore full opacity wherever the blur left the pixel nearly opaque. Eroding a mask to
    # find the "core" fails on this blade: its handle is ~5 px wide at working scale, so a
    # 3x3 erode leaves 3 px and the other 40% of the object stays translucent. Thresholding
    # the blurred alpha instead confines the ramp to the outermost pixel at any size.
    soft[soft >= 190] = 255
    return soft


def _hard_diag(alpha: np.ndarray) -> float:
    ys, xs = np.where(alpha >= 110)
    return float(np.hypot(np.ptp(xs), np.ptp(ys))) if ys.size else 0.0


def prepare_template(rgba: np.ndarray, kpts: np.ndarray, max_target_diag: float,
                     oversample: float = 4.0) -> tuple[np.ndarray, np.ndarray]:
    """Pre-shrink the cutout to a working resolution, carrying its keypoints along.

    The cutout is ~1400 px across; every synthetic blade is ~40 px. Rotating, edge-bleeding
    and warping the full-resolution image for each of 900 samples is most of this stage's
    runtime and buys nothing -- INTER_AREA is going to throw those pixels away. Keeping 4x
    the final size preserves all the detail the downscale can carry.
    """
    h, w = rgba.shape[:2]
    diag = float(np.hypot(w, h))
    target = max_target_diag * oversample
    if diag <= target:
        return rgba, kpts
    s = target / diag
    small = cv2.resize(rgba, (max(8, round(w * s)), max(8, round(h * s))), interpolation=cv2.INTER_AREA)
    return small, (np.asarray(kpts, np.float32) * s).astype(np.float32)


def _build_object(rgba, template_kpts, angle, target_diag, flip):
    """Rotate/scale/flip the cutout so the *feathered, thresholded* blade measures
    `target_diag` across.

    Sizing the raw canvas instead leaves the finished blade ~10% smaller than the number
    you set in step 3, because eroding and thresholding the alpha shaves a pixel off every
    edge. One corrective pass is enough: the relationship is linear in scale.
    """
    got = _transform_template(rgba, template_kpts, angle, target_diag, flip)
    if got is None:
        return None
    obj, pts = got
    if min(obj.shape[:2]) < 3:
        return None

    d = _hard_diag(_feather(obj[:, :, 3]))
    if d > 1.0 and abs(d - target_diag) / target_diag > 0.02:
        got = _transform_template(rgba, template_kpts, angle, target_diag * target_diag / d, flip)
        if got is None:
            return None
        obj, pts = got
        if min(obj.shape[:2]) < 3:
            return None
    return obj, pts


def place_one(
    canvas: np.ndarray,
    rgba: np.ndarray,
    template_kpts: np.ndarray,
    box: tuple[int, int, int, int],
    rng: np.random.Generator,
    cfg: SynthConfig,
    forbid: np.ndarray | None = None,
    centers: np.ndarray | None = None,
) -> Placement | None:
    """Composite one blade at a realistic size. Returns its mask and exact keypoints."""
    got = _build_object(rgba, template_kpts, float(rng.uniform(-180, 180)),
                        cfg.sample_diag(rng), rng.random() < 0.5)
    if got is None:
        return None
    obj, pts = got

    bgr, alpha = obj[:, :, :3].copy(), _feather(obj[:, :, 3].copy())

    bx, by, bw, bh = box
    oh, ow = alpha.shape[:2]
    ch, cw = canvas.shape[:2]

    # Truncation: the blade may hang past the content edge, as when it enters frame.
    mx, my = (int(ow * 0.45), int(oh * 0.45)) if rng.random() < cfg.truncate_prob else (0, 0)
    lo_x, hi_x = bx - mx, bx + bw - ow + mx
    lo_y, hi_y = by - my, by + bh - oh + my
    if hi_x <= lo_x or hi_y <= lo_y:
        return None

    if centers is not None and len(centers) and rng.random() < cfg.prior_prob:
        c = centers[int(rng.integers(0, len(centers)))]
        x = int(np.clip(c[0] * cw + rng.normal(0, cfg.prior_jitter) * cw - ow / 2, lo_x, hi_x))
        y = int(np.clip(c[1] * ch + rng.normal(0, cfg.prior_jitter) * ch - oh / 2, lo_y, hi_y))
    else:
        x = int(rng.integers(lo_x, hi_x + 1))
        y = int(rng.integers(lo_y, hi_y + 1))

    px0, py0 = max(0, x), max(0, y)
    px1, py1 = min(cw, x + ow), min(ch, y + oh)
    if px1 <= px0 or py1 <= py0:
        return None
    bgr = _harmonize(bgr, alpha, canvas[py0:py1, px0:px1], float(rng.uniform(*cfg.harmonize_strength)))
    bgr = np.clip(bgr.astype(np.float32) * rng.uniform(0.85, 1.15) + rng.uniform(-10, 10), 0, 255).astype(np.uint8)

    if rng.random() < cfg.motion_blur_prob:
        k = int(rng.integers(3, cfg.max_motion_blur + 1)) | 1
        kern = _motion_kernel(k, float(rng.uniform(0, 180)))
        bgr, alpha = cv2.filter2D(bgr, -1, kern), cv2.filter2D(alpha, -1, kern)

    sigma = float(rng.uniform(0.0, cfg.max_defocus_sigma))
    if sigma > 0.15:
        bgr, alpha = cv2.GaussianBlur(bgr, (0, 0), sigma), cv2.GaussianBlur(alpha, (0, 0), sigma)

    hard = (alpha >= 110)
    if not hard.any():
        return None
    full_area = float(hard.sum())
    hys, hxs = np.where(hard)
    full_diag = float(np.hypot(np.ptp(hxs), np.ptp(hys)))

    before = canvas.copy()
    if rng.random() < cfg.shadow_prob:
        _shadow(canvas, alpha, x, y, rng)
    vis = _paste(canvas, bgr, alpha, x, y)
    if vis.sum() == 0:
        canvas[:] = before
        return None

    kpts_raw = pts + np.array([x, y], np.float32)
    base_abs = kpts_raw[0]
    direction = kpts_raw[1] - kpts_raw[0]

    blocked = vis if forbid is None else cv2.bitwise_or(forbid, vis)
    if rng.random() < cfg.cut_prob:
        vis = _cut(canvas, vis, before, box, blocked, rng, cfg, base_abs, direction)
    if rng.random() < cfg.occlude_prob:
        vis = _occlude(canvas, vis, before, box, blocked, rng, cfg)

    visible = float((vis > 0).sum())
    if visible < MIN_INSTANCE_AREA_PX or visible < MIN_VISIBLE_FRACTION * full_area:
        canvas[:] = before
        return None

    ch, cw = canvas.shape[:2]

    # The base is the product. A sample whose base landed off-frame teaches nothing useful.
    bx, by, bw, bh = box
    if not (bx <= base_abs[0] < bx + bw and by <= base_abs[1] < by + bh):
        canvas[:] = before
        return None

    # The label carries base + angle only: kp1 is projected onto the fixed-radius circle,
    # so how much of the handle survived the cut cannot leak into the target.
    kpts = normalize_pair(np.stack([base_abs, base_abs + direction]))

    # A base the cut buried is labeled-but-occluded, never unlabeled.
    #
    # Probe a neighbourhood, not one pixel. The base marks the butt of the handle, so it sits
    # ON the silhouette edge -- roughly a pixel from the corner at working scale. Motion blur
    # spreads the alpha, that lone pixel falls under threshold, and a plainly visible base
    # gets flagged occluded. This reported 52% buried when the true rate was ~22%.
    ix, iy = int(round(base_abs[0])), int(round(base_abs[1]))
    r = BASE_PROBE_RADIUS
    patch = vis[max(0, iy - r) : iy + r + 1, max(0, ix - r) : ix + r + 1]
    base_vis = V_VISIBLE if patch.size and patch.max() > 0 else V_OCCLUDED

    vys, vxs = np.where(vis > 0)
    visible_diag = float(np.hypot(np.ptp(vxs), np.ptp(vys))) if vys.size else 0.0
    return Placement(vis, kpts.astype(np.float32), np.array([base_vis, V_VISIBLE], np.int32),
                     full_diag=full_diag, visible_diag=visible_diag)


def finish_frame(img: np.ndarray, rng: np.random.Generator, cfg: SynthConfig) -> np.ndarray:
    noise = rng.normal(0.0, float(rng.uniform(*cfg.noise_sigma)), img.shape).astype(np.float32)
    img = np.clip(img.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    q = int(rng.integers(*cfg.jpeg_quality))
    ok, enc = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), q])
    return cv2.imdecode(enc, cv2.IMREAD_COLOR) if ok else img
