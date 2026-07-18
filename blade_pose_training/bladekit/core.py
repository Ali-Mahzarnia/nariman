"""Paths, label IO, and geometry shared by every stage.

Label convention: `labels/<stem>.txt` holds YOLO-seg polygon lines. An **empty file is an
explicit negative** -- the frame was reviewed and contains no blade. A *missing* file means
the frame was never reviewed. The distinction matters: negatives are training data.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

REPO = Path(__file__).resolve().parent.parent


def pick_device() -> str:
    try:
        import torch

        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "0"
    except Exception:
        pass
    return "cpu"


@dataclass(frozen=True)
class ObjectPaths:
    root: Path

    @property
    def frames(self) -> Path:
        return self.root / "frames"

    @property
    def labels(self) -> Path:
        return self.root / "labels"

    @property
    def cutouts(self) -> Path:
        return self.root / "source_cutouts"

    @property
    def templates(self) -> Path:
        return self.root / "templates"

    @property
    def meta(self) -> Path:
        return self.root / "meta"

    @property
    def hard_negatives(self) -> Path:
        return self.root / "hard_negatives"

    @property
    def videos(self) -> Path:
        return self.root / "videos"

    @property
    def dataset(self) -> Path:
        return self.root / "dataset"

    @property
    def runs(self) -> Path:
        return self.root / "runs"

    @property
    def logs(self) -> Path:
        return self.root / "logs"

    @property
    def qc(self) -> Path:
        return self.root / "qc"

    @property
    def scale_file(self) -> Path:
        return self.meta / "scale.json"

    @property
    def tags_file(self) -> Path:
        return self.meta / "tags.json"

    @property
    def predict_config(self) -> Path:
        return self.meta / "predict_config.json"

    def label_for(self, image: Path) -> Path:
        return self.labels / f"{image.stem}.txt"

    def ensure(self) -> None:
        for d in (self.frames, self.labels, self.cutouts, self.templates, self.meta,
                  self.hard_negatives, self.videos, self.runs, self.logs, self.qc):
            d.mkdir(parents=True, exist_ok=True)


def resolve_object(arg: str | Path) -> ObjectPaths:
    p = Path(arg)
    if not p.is_absolute():
        p = (REPO / p).resolve()
    if not p.exists():
        raise SystemExit(f"Object folder not found: {p}")
    paths = ObjectPaths(p)
    paths.ensure()
    return paths


def resolve_video(paths: ObjectPaths, video: Path) -> Path:
    """Accept an absolute path, a path relative to cwd, or a name inside objects/*/videos."""
    for cand in (video, Path.cwd() / video, paths.videos / video.name, paths.root / video.name):
        if cand.exists():
            return cand.resolve()
    raise SystemExit(f"Video not found: {video} (looked in {paths.videos})")


# ---------------------------------------------------------------- label IO


def read_polygons(label_path: Path) -> list[np.ndarray]:
    """Normalized polygons, (N,2) float32 in 0..1. Empty list = negative frame."""
    if not label_path.exists():
        return []
    polys: list[np.ndarray] = []
    for line in label_path.read_text().strip().splitlines():
        parts = line.split()
        if len(parts) < 7:
            continue
        polys.append(np.array([float(v) for v in parts[1:]], np.float32).reshape(-1, 2))
    return polys


def write_polygons(label_path: Path, polys: list[np.ndarray]) -> None:
    label_path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["0 " + " ".join(f"{v:.6f}" for v in np.clip(p.reshape(-1), 0.0, 1.0)) for p in polys]
    label_path.write_text("\n".join(lines) + ("\n" if lines else ""))


def is_reviewed(label_path: Path) -> bool:
    return label_path.exists()


def is_negative(label_path: Path) -> bool:
    return label_path.exists() and not label_path.read_text().strip()


def mask_to_polygons(mask: np.ndarray, min_area: float = 6.0, eps_frac: float = 0.004) -> list[np.ndarray]:
    """Contour a binary mask into polygons in absolute pixel coordinates.

    The epsilon is deliberately tight. At 36 px, v1's 0.0035*perimeter collapsed the blade
    to a triangle, and that label noise is the same order as the mask error we measure.
    """
    cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for cnt in cnts:
        if cv2.contourArea(cnt) < min_area:
            continue
        eps = max(0.35, eps_frac * cv2.arcLength(cnt, True))
        approx = cv2.approxPolyDP(cnt, eps, True).reshape(-1, 2)
        if len(approx) >= 3:
            out.append(approx.astype(np.float32))
    return out


def largest_polygon(mask: np.ndarray, min_area: float = 6.0) -> np.ndarray | None:
    polys = mask_to_polygons(mask, min_area)
    if not polys:
        return None
    return max(polys, key=lambda p: cv2.contourArea(p.astype(np.int32)))


def normalize(poly: np.ndarray, w: int, h: int) -> np.ndarray:
    p = poly.astype(np.float32).copy()
    p[:, 0] /= w
    p[:, 1] /= h
    return np.clip(p, 0.0, 1.0)


def denormalize(poly: np.ndarray, w: int, h: int) -> np.ndarray:
    p = poly.astype(np.float32).copy()
    p[:, 0] *= w
    p[:, 1] *= h
    return p


def polygons_to_mask(polys: list[np.ndarray], h: int, w: int) -> np.ndarray:
    mask = np.zeros((h, w), np.uint8)
    if polys:
        cv2.fillPoly(mask, [p.astype(np.int32) for p in polys], 255)
    return mask


def poly_diag(poly: np.ndarray) -> float:
    return float(np.hypot(np.ptp(poly[:, 0]), np.ptp(poly[:, 1])))


# ------------------------------------------------------------ frame geometry


def content_box(frame: np.ndarray, thresh: int = 18) -> tuple[int, int, int, int]:
    """Bounding box of non-letterbox content, (x, y, w, h).

    The source videos carry ~29% of their height as black bars. A blade pasted into a bar
    is an image the model can never meet at inference.
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
    rows = np.where(gray.max(axis=1) > thresh)[0]
    cols = np.where(gray.max(axis=0) > thresh)[0]
    if rows.size == 0 or cols.size == 0:
        h, w = gray.shape[:2]
        return 0, 0, w, h
    return int(cols.min()), int(rows.min()), int(np.ptp(cols) + 1), int(np.ptp(rows) + 1)


# ------------------------------------------------------------------- meta IO


def load_json(path: Path, default: dict | None = None) -> dict:
    if path.exists():
        return json.loads(path.read_text())
    return dict(default or {})


def save_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def load_scale(paths: ObjectPaths) -> dict:
    """{'diag_min_px': float, 'diag_max_px': float} -- the on-screen size of a real blade."""
    s = load_json(paths.scale_file)
    if not s:
        raise SystemExit(
            f"No scale set. Run:  python 03_set_scale.py --object {paths.root.name}\n"
            f"(expected {paths.scale_file})"
        )
    return s


def real_scale_stats(paths: ObjectPaths) -> tuple[int, float, float, float] | None:
    """(n, p5, median, p95) of real instance bbox diagonals in px, or None if no positives."""
    diags = []
    for lab in sorted(paths.labels.glob("*.txt")):
        polys = read_polygons(lab)
        if not polys:
            continue
        img = cv2.imread(str(paths.frames / f"{lab.stem}.jpg"))
        if img is None:
            continue
        h, w = img.shape[:2]
        for p in polys:
            diags.append(poly_diag(denormalize(p, w, h)))
    if not diags:
        return None
    d = np.array(diags)
    return len(d), float(np.percentile(d, 5)), float(np.median(d)), float(np.percentile(d, 95))


# ------------------------------------------------------------- frame naming


def frame_name(video: Path, index: int) -> str:
    return f"{video.stem}_f{index:06d}"


def parse_frame_name(stem: str) -> tuple[str, int]:
    video, _, idx = stem.rpartition("_f")
    return video, int(idx) if idx.isdigit() else 0
