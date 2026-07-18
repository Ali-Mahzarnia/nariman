"""Step 8 -- run the model over a video, drawing the handle base and its angle.

Inference mirrors training exactly: the ROI is cut into the same CROP x CROP window the
model trained on and upscaled to imgsz. That is both the accurate choice (2x the pixels on
a ~40 px handle) and the fast one -- you never run the network on a 960x760 frame.

Defaults for weights and conf come from `meta/predict_config.json`, written by 06_train.py
after it calibrated the threshold on the real-only val split.

`--csv` writes per-frame base position and angle, which is the actual deliverable.
Output video is H.264, playable as-is.
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

from bladekit.core import load_json, pick_device, resolve_object, resolve_video
from bladekit.infer import CropDetector, Detections, box_iou
from bladekit.kpts import angle_deg
from bladekit.video import VideoSink

COL_BASE = (0, 220, 255)
COL_DIR = (255, 160, 0)


def select_roi(video: Path, frame_index: int, max_width: int):
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise SystemExit(f"Could not open video: {video}")
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, min(frame_index, max(0, total - 1))))
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise SystemExit(f"Could not read frame {frame_index}")
    h, w = frame.shape[:2]
    scale = min(1.0, max_width / w)
    st: dict = {"drag": False, "a": None, "b": None}
    win = "drag ROI | ENTER confirm | r reset | q quit"

    def mouse(event, x, y, _f, _p):
        if event == cv2.EVENT_LBUTTONDOWN:
            st.update(drag=True, a=(x, y), b=(x, y))
        elif event == cv2.EVENT_MOUSEMOVE and st["drag"]:
            st["b"] = (x, y)
        elif event == cv2.EVENT_LBUTTONUP:
            st.update(drag=False, b=(x, y))

    cv2.namedWindow(win)
    cv2.setMouseCallback(win, mouse)
    try:
        while True:
            view = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale != 1.0 else frame.copy()
            cv2.putText(view, "drag ROI | ENTER ok | r reset | q quit", (12, 28),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            if st["a"] and st["b"]:
                cv2.rectangle(view, st["a"], st["b"], (0, 255, 255), 2)
            cv2.imshow(win, view)
            key = cv2.waitKey(20) & 0xFF
            if key in (13, ord("s")) and st["a"] and st["b"]:
                x1, x2 = sorted((st["a"][0], st["b"][0]))
                y1, y2 = sorted((st["a"][1], st["b"][1]))
                if x2 - x1 < 10 or y2 - y1 < 10:
                    print("ROI too small.")
                    continue
                return (int(x1 / scale), int(y1 / scale), int((x2 - x1) / scale), int((y2 - y1) / scale))
            if key == ord("r"):
                st.update(a=None, b=None)
            if key == ord("q"):
                raise SystemExit("cancelled")
    finally:
        cv2.destroyWindow(win)


def clamp_roi(roi, w: int, h: int):
    x, y, rw, rh = roi
    x, y = max(0, min(x, w - 1)), max(0, min(y, h - 1))
    return x, y, max(1, min(rw, w - x)), max(1, min(rh, h - y))


def box_center(b):
    return float((b[0] + b[2]) / 2), float((b[1] + b[3]) / 2)


class Smoother:
    """Outlier gate plus exponential smoothing of the base point and handle direction.

    Two different problems, two different tools, and conflating them wastes an afternoon:

    * Sub-pixel keypoint noise. With ~1.2 px base error over a 24 px direction radius this is
      ~1 deg of frame-to-frame angle wobble. An exponential filter averages it away.
    * Outliers -- a false positive elsewhere in frame, or a momentary mis-detection. Measured
      on test3: median frame-to-frame angle change 0.5 deg, but a 166 deg maximum, and a
      42 px base jump. Averaging does not remove an outlier, it *spreads* it over the next
      several frames. So we reject it instead.

    A blade held in a hand cannot teleport across the frame or spin 166 deg between
    consecutive frames at 23 fps. Anything that does is not the blade.

    The direction is smoothed as a unit vector, never as an angle: averaging 179 deg and
    -179 deg numerically gives 0 deg, pointing the handle exactly backwards.
    """

    def __init__(self, alpha: float, max_jump_px: float = 40.0, max_turn_deg: float = 45.0,
                 reset_after: int = 5, motion_ref_px: float = 12.0, motion_ref_deg: float = 12.0) -> None:
        self.alpha = alpha
        self.max_jump_px = max_jump_px
        self.max_turn_deg = max_turn_deg
        self.reset_after = reset_after
        # Motion at or above this per-frame magnitude disables smoothing entirely.
        self.motion_ref_px = motion_ref_px
        self.motion_ref_deg = motion_ref_deg
        self.base: np.ndarray | None = None
        self.dir: np.ndarray | None = None
        self.missed = 0
        self.rejected = 0

    def _reacquiring(self) -> bool:
        return self.base is None or self.missed >= self.reset_after

    def update(self, base: np.ndarray, tip: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
        """Returns the smoothed (base, tip), or None if this frame was rejected as an outlier."""
        d = tip - base
        n = float(np.hypot(*d))
        u = d / n if n > 1e-6 else np.array([1.0, 0.0], np.float32)

        if self._reacquiring():
            self.base, self.dir = base.astype(np.float32), u.astype(np.float32)
            self.missed = 0
            return self.base.copy(), (self.base + self.dir * n).astype(np.float32)

        jump = float(np.hypot(*(base - self.base)))
        # Signed 2D cross product by hand: numpy 2 dropped cross() for 2-vectors.
        cross = float(self.dir[0] * u[1] - self.dir[1] * u[0])
        turn = abs(np.degrees(np.arctan2(cross, float(np.dot(self.dir, u)))))
        if jump > self.max_jump_px or turn > self.max_turn_deg:
            self.missed += 1
            self.rejected += 1
            return None

        # Adaptive alpha. A fixed EMA smooths a moving blade as hard as a still one, so fast
        # motion lags by several frames. Sub-pixel noise only needs suppressing when the
        # blade is *not* moving; when it is, the observation is more trustworthy than the
        # history. Blend toward alpha=1 (no smoothing) as measured motion grows.
        speed = max(jump / self.motion_ref_px, turn / self.motion_ref_deg)
        a = self.alpha + (1.0 - self.alpha) * min(1.0, speed)

        self.base = (1 - a) * self.base + a * base
        self.dir = (1 - a) * self.dir + a * u
        m = float(np.hypot(*self.dir))
        if m > 1e-6:
            self.dir = self.dir / m
        self.missed = 0
        return self.base.copy(), (self.base + self.dir * n).astype(np.float32)

    def miss(self) -> None:
        self.missed += 1


class SingleObjectTracker:
    """Temporal gate: a low-confidence detection that teleports away from the last accepted
    one is rejected, which kills single-frame false positives without lowering conf."""

    def __init__(self, max_jump, min_iou, reacquire_after, smooth, high_conf):
        self.max_jump, self.min_iou = max_jump, min_iou
        self.reacquire_after, self.smooth, self.high_conf = reacquire_after, smooth, high_conf
        self.box = None
        self.missed = 0

    def choose(self, det: Detections):
        if len(det) == 0:
            self.missed += 1
            return None
        if self.box is None or self.missed >= self.reacquire_after:
            i = int(np.argmax(det.confs))
            self.box, self.missed = det.boxes[i].copy(), 0
            return i
        pcx, pcy = box_center(self.box)
        best, best_score = None, -1e9
        for i, b in enumerate(det.boxes):
            cx, cy = box_center(b)
            dist = float(np.hypot(cx - pcx, cy - pcy))
            v = box_iou(self.box, b)
            conf = float(det.confs[i])
            if not (dist <= self.max_jump or v >= self.min_iou) and conf < self.high_conf:
                continue
            score = conf + 0.9 * v - 0.35 * min(1.0, dist / max(1.0, self.max_jump))
            if score > best_score:
                best, best_score = i, score
        if best is None:
            self.missed += 1
            return None
        self.box = (1 - self.smooth) * self.box + self.smooth * det.boxes[best]
        self.missed = 0
        return best


def draw(frame, det: Detections, box_width, hide_boxes, roi, show_roi, labels):
    out = frame.copy()
    for i in range(len(det)):
        b = det.boxes[i]
        if not hide_boxes:
            cv2.rectangle(out, (int(b[0]), int(b[1])), (int(b[2]), int(b[3])), (0, 0, 255), box_width)
        if det.kpts is None or det.kpts.size == 0:
            continue
        k = det.kpts[i]
        base, tip = k[0][:2], k[1][:2]
        d = tip - base
        n = float(np.hypot(*d))
        u = d / n if n > 1e-6 else np.array([1.0, 0.0], np.float32)
        DISPLAY_LEN = 90.0  # visualization only -- independent of the model's real kp1 radius
        disp_tip = base + u * DISPLAY_LEN
        cv2.arrowedLine(out, tuple(base.astype(int)), tuple(disp_tip.astype(int)),
                        (0, 255, 0), 1, cv2.LINE_AA, tipLength=0.15)
        cv2.circle(out, tuple(base.astype(int)), 2, COL_BASE, -1)
        if labels:
            a = angle_deg(np.stack([base, tip]))
            cv2.putText(out, f"{a:.0f}deg  {det.confs[i]:.2f}",
                        (int(b[0]), max(12, int(b[1]) - 5)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1, cv2.LINE_AA)
    if roi and show_roi:
        rx, ry, rw, rh = roi
        cv2.rectangle(out, (rx, ry), (rx + rw, ry + rh), (0, 200, 255), 1)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--video", type=Path, required=True)
    ap.add_argument("--weights", default=None)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--csv", type=Path, default=None, help="Write per-frame base x,y and angle.")
    ap.add_argument("--conf", type=float, default=None)
    ap.add_argument("--crop", type=int, default=None)
    ap.add_argument("--imgsz", type=int, default=None)
    ap.add_argument("--roi", default=None, help="x,y,w,h. Omit to drag it interactively.")
    ap.add_argument("--roi-frame", type=int, default=0)
    ap.add_argument("--no-roi", action="store_true", help="Scan the whole content box (tiled).")
    ap.add_argument("--roi-strict", action="store_true",
                    help="Count a detection only if its base keypoint is inside the drawn "
                         "ROI. Makes the ROI a hard boundary, not just a seed window.")
    ap.add_argument("--box-width", type=int, default=1)
    ap.add_argument("--hide-boxes", action="store_true")
    ap.add_argument("--labels", action="store_true")
    ap.add_argument("--show-roi", action="store_true")
    ap.add_argument("--best-only", action="store_true")
    ap.add_argument("--smooth", type=float, default=0.0, metavar="ALPHA",
                    help="Temporal smoothing + outlier gate, 0=off. 0.3 is a good start; "
                         "lower = smoother but laggier. Averages away sub-pixel keypoint "
                         "noise AND rejects frames where the blade teleports or spins.")
    ap.add_argument("--max-jump-px", type=float, default=40.0,
                    help="Reject a detection whose base moved more than this since the last "
                         "accepted frame. A held blade does not teleport.")
    ap.add_argument("--max-turn-deg", type=float, default=45.0,
                    help="Reject a detection whose handle turned more than this in one frame.")
    ap.add_argument("--reset-after", type=int, default=5,
                    help="After this many consecutive rejected frames, give up holding the last "
                         "good pose and re-acquire. Raise it to keep holding the angle through a "
                         "longer occlusion (e.g. a finger lingering over the handle).")
    ap.add_argument("--motion-ref", type=float, default=12.0,
                    help="Per-frame motion (px or deg) at which smoothing fully disengages. "
                         "Higher = smoother through fast motion but laggier.")
    ap.add_argument("--single-track", action="store_true")
    ap.add_argument("--track-max-jump", type=float, default=160.0)
    ap.add_argument("--track-min-iou", type=float, default=0.05)
    ap.add_argument("--track-reacquire-after", type=int, default=8)
    ap.add_argument("--track-smooth", type=float, default=0.35)
    ap.add_argument("--track-high-conf", type=float, default=0.60)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--max-width", type=int, default=1400)
    args = ap.parse_args()

    paths = resolve_object(args.object)
    cfg = load_json(paths.predict_config)
    weights = args.weights or cfg.get("weights")
    if not weights or not Path(weights).exists():
        raise SystemExit(f"Weights not found: {weights}. Train first, or pass --weights.")
    conf = args.conf if args.conf is not None else cfg.get("conf", 0.25)
    crop = args.crop or cfg.get("crop", 320)
    imgsz = args.imgsz or cfg.get("imgsz", 640)

    video = resolve_video(paths, args.video)
    out = args.out or (paths.runs / "predict" / f"{video.stem}.mp4")

    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise SystemExit(f"Could not open video: {video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0

    roi = None
    if not args.no_roi:
        if args.roi:
            vals = tuple(int(v) for v in args.roi.split(","))
            if len(vals) != 4:
                raise SystemExit("--roi must be x,y,w,h")
            roi = clamp_roi(vals, width, height)
        else:
            cap.release()
            roi = clamp_roi(select_roi(video, args.roi_frame, args.max_width), width, height)
            cap = cv2.VideoCapture(str(video))

    device = pick_device()
    detector = CropDetector(YOLO(str(weights)), crop, imgsz, conf, device)
    sink = VideoSink(out, fps, (width, height))
    tracker = SingleObjectTracker(args.track_max_jump, args.track_min_iou,
                                  args.track_reacquire_after, args.track_smooth,
                                  args.track_high_conf) if args.single_track else None
    smoother = Smoother(args.smooth, args.max_jump_px, args.max_turn_deg,
                        reset_after=args.reset_after,
                        motion_ref_px=args.motion_ref, motion_ref_deg=args.motion_ref) if args.smooth > 0 else None

    print(f"weights={weights}")
    print(f"device={device} conf={conf} crop={crop} imgsz={imgsz} roi={roi or 'content box (tiled)'}")
    print(f"smoothing={'off' if smoother is None else f'alpha={args.smooth}'}")
    print(f"writing={out} codec={sink.codec}")

    rows = []
    i = detected = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok or (args.limit and i >= args.limit):
                break
            i += 1
            det = detector.detect(frame, roi)
            if args.roi_strict and roi is not None and len(det):
                # The model must run on a >=crop window, so a small ROI is padded up and a
                # detection can land in that margin. With --roi-strict we keep only detections
                # whose BASE keypoint sits inside the drawn ROI, so the box is a hard boundary.
                rx, ry, rw, rh = roi
                keep = []
                for j in range(len(det)):
                    bx, by = det.kpts[j][0][:2]
                    if rx <= bx <= rx + rw and ry <= by <= ry + rh:
                        keep.append(j)
                det = det.take(keep)
            if tracker is not None:
                k = tracker.choose(det)
                det = det.take([k] if k is not None else [])
            elif args.best_only and len(det):
                det = det.best()
            if len(det) and det.kpts is not None and det.kpts.size:
                b, n = det.kpts[0][0][:2].copy(), det.kpts[0][1][:2].copy()
                if smoother is not None:
                    got = smoother.update(b, n)
                    if got is None:
                        # Teleported or spun: not the blade. Drop the frame entirely rather
                        # than let one bad detection bleed into the next several.
                        det = Detections.empty()
                        rows.append([i, "", "", "", ""])
                        sink.write(draw(frame, det, args.box_width, args.hide_boxes,
                                        roi, args.show_roi, args.labels))
                        if i % 50 == 0 or i == total:
                            print(f"frame {i}/{total} detected={detected} rejected={smoother.rejected}")
                        continue
                    b, n = got
                    det.kpts[0][0][:2], det.kpts[0][1][:2] = b, n
                detected += 1
                rows.append([i, round(float(b[0]), 2), round(float(b[1]), 2),
                             round(angle_deg(np.stack([b, n])), 2), round(float(det.confs[0]), 4)])
            else:
                if smoother is not None:
                    smoother.miss()
                rows.append([i, "", "", "", ""])
            sink.write(draw(frame, det, args.box_width, args.hide_boxes, roi, args.show_roi, args.labels))
            if i % 50 == 0 or i == total:
                print(f"frame {i}/{total} detected={detected}")
    finally:
        cap.release()
        sink.close()

    if args.csv:
        args.csv.parent.mkdir(parents=True, exist_ok=True)
        with open(args.csv, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["frame", "base_x", "base_y", "angle_deg", "conf"])
            w.writerows(rows)
        print(f"csv: {args.csv}")

    if smoother is not None:
        print(f"outlier frames rejected: {smoother.rejected}")
    print(f"\ndone: {out}")
    print(f"frames={i} frames_with_detection={detected} ({detected / max(1, i):.1%})")


if __name__ == "__main__":
    main()
