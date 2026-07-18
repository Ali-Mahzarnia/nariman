"""Crop-window inference, shared by proposal, mining, and prediction.

The model trained on CROP x CROP windows upscaled to imgsz. Feeding it a full frame would
show the blade at a scale it never saw, so we always cut the same kind of window, run the
batch, and merge back into full-frame coordinates with NMS across window seams.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .core import content_box
from .crops import roi_to_window, tile_windows


@dataclass
class Detections:
    """Boxes, confidences, and keypoints in full-frame coordinates.

    `kpts` is (N, K, 3): x, y, and per-keypoint confidence. Ultralytics reports low
    confidence for points it believes are occluded, which is signal, not noise.
    """

    boxes: np.ndarray
    confs: np.ndarray
    kpts: np.ndarray | None = None

    def __len__(self) -> int:
        return len(self.boxes)

    @classmethod
    def empty(cls, n_kpts: int = 2) -> "Detections":
        return cls(np.zeros((0, 4), np.float32), np.zeros((0,), np.float32),
                   np.zeros((0, n_kpts, 3), np.float32))

    def take(self, idx: list[int]) -> "Detections":
        if not idx:
            return Detections.empty(self.kpts.shape[1] if self.kpts is not None and self.kpts.size else 2)
        return Detections(self.boxes[idx], self.confs[idx],
                          None if self.kpts is None else self.kpts[idx])

    def best(self) -> "Detections":
        return self.take([int(np.argmax(self.confs))]) if len(self) else self


def box_iou(a: np.ndarray, b: np.ndarray) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return float(inter / union) if union > 0 else 0.0


def nms(det: Detections, iou_thresh: float = 0.5) -> Detections:
    if len(det) <= 1:
        return det
    order = list(np.argsort(-det.confs))
    keep: list[int] = []
    while order:
        i = order.pop(0)
        keep.append(int(i))
        order = [j for j in order if box_iou(det.boxes[i], det.boxes[j]) < iou_thresh]
    return det.take(keep)


class CropDetector:
    def __init__(self, model, crop: int, imgsz: int, conf: float, device: str,
                 overlap: float = 0.25, iou: float = 0.5) -> None:
        self.model = model
        self.crop = crop
        self.imgsz = imgsz
        self.conf = conf
        self.device = device
        self.overlap = overlap
        self.iou = iou

    def windows(self, frame: np.ndarray, roi: tuple[int, int, int, int] | None) -> list[tuple[int, int, int, int]]:
        h, w = frame.shape[:2]
        if roi is None:
            roi = content_box(frame)
        if roi[2] <= self.crop and roi[3] <= self.crop:
            return [roi_to_window(roi, self.crop, w, h)]
        return tile_windows(roi, self.crop, self.overlap, w, h)

    def detect(self, frame: np.ndarray, roi: tuple[int, int, int, int] | None = None) -> Detections:
        wins = self.windows(frame, roi)
        patches = [frame[y : y + ch, x : x + cw] for x, y, cw, ch in wins]
        if not patches:
            return Detections.empty()

        results = self.model.predict(source=patches, conf=self.conf, imgsz=self.imgsz,
                                     device=self.device, verbose=False)

        boxes, confs, kpts = [], [], []
        for (wx, wy, _, _), r in zip(wins, results):
            if r.boxes is None or len(r.boxes) == 0:
                continue
            b = r.boxes.xyxy.cpu().numpy().astype(np.float32)
            b[:, [0, 2]] += wx
            b[:, [1, 3]] += wy
            boxes.append(b)
            confs.append(r.boxes.conf.cpu().numpy().astype(np.float32))

            if r.keypoints is not None and r.keypoints.data is not None:
                k = r.keypoints.data.cpu().numpy().astype(np.float32).copy()  # (n, K, 3)
                k[:, :, 0] += wx
                k[:, :, 1] += wy
                kpts.append(k)
            else:
                kpts.append(np.zeros((len(b), 2, 3), np.float32))

        if not boxes:
            return Detections.empty()
        return nms(Detections(np.vstack(boxes), np.concatenate(confs), np.concatenate(kpts)), self.iou)
