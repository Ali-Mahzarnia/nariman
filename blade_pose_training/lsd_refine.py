"""Prototype: YOLO for coarse base+angle, then a line-segment detector (LSD) refines the
angle using whichever handle-wall edges are actually visible -- the way a human reads the
angle off either wall even when a finger covers one of them.

RED   = YOLO's raw angle (base -> kp1)
CYAN  = LSD-refined angle (base fixed by YOLO, direction refined from nearby edges)

    PY=.venv/bin/python
    $PY lsd_refine.py --object objects/blade1 --video objects/blade1/videos/test3.mp4 \
        --weights objects/blade1/runs/train/clean/weights/last.pt

Drag an ROI on the first frame like 08_predict.py, ENTER to confirm.
"""
import argparse
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

CROP = 320
IMGSZ = 640
PATCH_R = 45  # half-side of the LSD search patch around the base, full-frame px
ANGLE_TOL_DEG = 15  # keep segments within this of YOLO's coarse angle (mod 180) -- tightened
MIN_SEG_LEN = 6.0
MAX_PERP_DIST = 22.0  # reject segments whose midpoint is this far off the base-tip axis line


class AngleSmoother:
    """EMA + outlier gate on a direction, as a unit vector so it never wraps backwards."""

    def __init__(self, alpha=0.35, max_turn_deg=30.0):
        self.alpha = alpha
        self.max_turn_deg = max_turn_deg
        self.vec = None

    def update(self, angle_deg):
        u = np.array([np.cos(np.radians(angle_deg)), np.sin(np.radians(angle_deg))], np.float32)
        if self.vec is None:
            self.vec = u
            return angle_deg
        cross = float(self.vec[0] * u[1] - self.vec[1] * u[0])
        dot = float(np.dot(self.vec, u))
        turn = abs(np.degrees(np.arctan2(cross, dot)))
        if turn > self.max_turn_deg:
            return float(np.degrees(np.arctan2(self.vec[1], self.vec[0])))  # reject, hold
        self.vec = (1 - self.alpha) * self.vec + self.alpha * u
        self.vec /= max(1e-6, float(np.hypot(*self.vec)))
        return float(np.degrees(np.arctan2(self.vec[1], self.vec[0])))


def clamp_crop(cx, cy, w, h):
    x = int(np.clip(cx - CROP // 2, 0, max(0, w - CROP)))
    y = int(np.clip(cy - CROP // 2, 0, max(0, h - CROP)))
    return x, y


def yolo_predict(model, frame, cx, cy, conf):
    h, w = frame.shape[:2]
    x, y = clamp_crop(cx, cy, w, h)
    patch = frame[y:y + CROP, x:x + CROP]
    r = model.predict(patch, imgsz=IMGSZ, conf=conf, device="cpu", verbose=False)[0]
    if r.keypoints is None or len(r.keypoints.data) == 0:
        return None
    i = int(r.boxes.conf.argmax())
    kp = r.keypoints.data.cpu().numpy()[i][:, :2] + np.array([x, y], np.float32)
    return kp[0], kp[1], float(r.boxes.conf[i])


def ang_mod180(deg):
    return deg % 180.0


def circ_diff180(a, b):
    d = abs(ang_mod180(a) - ang_mod180(b))
    return min(d, 180 - d)


_lsd = cv2.createLineSegmentDetector(0)


def lsd_refine(frame, base, coarse_angle_deg):
    h, w = frame.shape[:2]
    x0 = int(np.clip(base[0] - PATCH_R, 0, w - 1))
    y0 = int(np.clip(base[1] - PATCH_R, 0, h - 1))
    x1 = int(np.clip(base[0] + PATCH_R, 0, w - 1))
    y1 = int(np.clip(base[1] + PATCH_R, 0, h - 1))
    if x1 - x0 < 10 or y1 - y0 < 10:
        return None
    patch = cv2.cvtColor(frame[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
    lines = _lsd.detect(patch)[0]
    if lines is None:
        return None

    base_local = np.array([base[0] - x0, base[1] - y0], np.float32)
    d = np.array([np.cos(np.radians(coarse_angle_deg)), np.sin(np.radians(coarse_angle_deg))], np.float32)

    good = []
    for l in lines[:, 0]:
        x1s, y1s, x2s, y2s = l
        length = float(np.hypot(x2s - x1s, y2s - y1s))
        if length < MIN_SEG_LEN:
            continue
        seg_angle = float(np.degrees(np.arctan2(y2s - y1s, x2s - x1s)))
        if circ_diff180(seg_angle, coarse_angle_deg) > ANGLE_TOL_DEG:
            continue
        mid = np.array([(x1s + x2s) / 2, (y1s + y2s) / 2], np.float32)
        perp_dist = abs(float((mid - base_local)[0] * d[1] - (mid - base_local)[1] * d[0]))
        if perp_dist > MAX_PERP_DIST:
            continue
        good.append((seg_angle, length))
    if len(good) < 2:
        return None  # a single segment could be a stray finger edge -- require agreement

    # reject if the matched segments don't actually agree with each other (mixed signal)
    angles_only = [a for a, _ in good]
    spread = max(circ_diff180(a, b) for a in angles_only for b in angles_only)
    if spread > 12.0:
        return None

    # weighted circular mean mod 180: double the angle, average as unit vectors, halve back
    vecs = np.array([[np.cos(np.radians(2 * a)), np.sin(np.radians(2 * a))] for a, _ in good])
    weights = np.array([wgt for _, wgt in good])
    mean_vec = (vecs * weights[:, None]).sum(axis=0)
    mean_angle2 = np.degrees(np.arctan2(mean_vec[1], mean_vec[0]))
    refined = ang_mod180(mean_angle2 / 2.0)

    # resolve the 180-deg ambiguity using YOLO's coarse direction
    if circ_diff180(refined, coarse_angle_deg) > 90:
        refined = ang_mod180(refined + 180)
    # pick whichever of {refined, refined+180} is closer to coarse in FULL 360 sense
    cands = [refined, refined + 180]
    best = min(cands, key=lambda a: abs(((a - coarse_angle_deg + 180) % 360) - 180))
    return best, len(good)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--video", required=True)
    ap.add_argument("--weights", required=True)
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    model = YOLO(args.weights)
    cap = cv2.VideoCapture(args.video)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # drag ROI on frame 0
    ok, frame0 = cap.read()
    st = {"drag": False, "a": None, "b": None}

    def mouse(event, x, y, flags, _):
        if event == cv2.EVENT_LBUTTONDOWN:
            st.update(drag=True, a=(x, y), b=(x, y))
        elif event == cv2.EVENT_MOUSEMOVE and st["drag"]:
            st["b"] = (x, y)
        elif event == cv2.EVENT_LBUTTONUP:
            st.update(drag=False, b=(x, y))

    win = "drag ROI | ENTER confirm"
    cv2.namedWindow(win)
    cv2.setMouseCallback(win, mouse)
    roi_center = (W // 2, H // 2)
    while True:
        view = frame0.copy()
        if st["a"] and st["b"]:
            cv2.rectangle(view, st["a"], st["b"], (0, 255, 255), 2)
        cv2.putText(view, "drag ROI | ENTER ok", (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        cv2.imshow(win, view)
        k = cv2.waitKey(20) & 0xFF
        if k in (13, ord("s")) and st["a"] and st["b"]:
            cx = (st["a"][0] + st["b"][0]) // 2
            cy = (st["a"][1] + st["b"][1]) // 2
            roi_center = (cx, cy)
            break
        if k == ord("q"):
            cv2.destroyWindow(win)
            return
    cv2.destroyWindow(win)

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    writer = None
    if args.out:
        writer = cv2.VideoWriter(args.out, cv2.VideoWriter_fourcc(*"mp4v"), 22, (W, H))

    track = roi_center
    n_refined = n_yolo_only = n_none = 0
    smoother = AngleSmoother(alpha=0.35, max_turn_deg=30.0)

    for idx in range(total):
        ok, frame = cap.read()
        if not ok:
            break
        det = yolo_predict(model, frame, track[0], track[1], args.conf)
        vis = frame.copy()
        if det is not None:
            base, tip, conf = det
            track = (int(base[0]), int(base[1]))
            coarse_angle = float(np.degrees(np.arctan2(tip[1] - base[1], tip[0] - base[0])))

            bx, by = int(base[0]), int(base[1])
            ex = int(bx + 90 * np.cos(np.radians(coarse_angle)))
            ey = int(by + 90 * np.sin(np.radians(coarse_angle)))
            cv2.line(vis, (bx, by), (ex, ey), (0, 0, 255), 1, cv2.LINE_8)  # RED = yolo raw

            ref = lsd_refine(frame, base, coarse_angle)
            if ref is not None:
                raw_refined_angle, n_lines = ref
                refined_angle = smoother.update(raw_refined_angle)
            elif smoother.vec is not None:
                refined_angle = float(np.degrees(np.arctan2(smoother.vec[1], smoother.vec[0])))  # hold
            else:
                refined_angle = None
            if refined_angle is not None:
                rx = int(bx + 90 * np.cos(np.radians(refined_angle)))
                ry = int(by + 90 * np.sin(np.radians(refined_angle)))
                cv2.line(vis, (bx, by), (rx, ry), (255, 255, 0), 1, cv2.LINE_8)  # CYAN = lsd refined
                n_refined += 1
            else:
                n_yolo_only += 1
            vis[by, bx] = (0, 255, 0)
            cv2.putText(vis, f"f{idx}/{total}  conf={conf:.2f}", (6, 16),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
        else:
            n_none += 1
            cv2.putText(vis, f"f{idx}/{total}  NO DETECTION", (6, 16),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)

        if writer:
            writer.write(vis)
        if idx % 50 == 0:
            print(f"frame {idx}/{total}  refined={n_refined} yolo_only={n_yolo_only} none={n_none}")

    if writer:
        writer.release()
    cap.release()
    print(f"done. refined={n_refined} yolo_only={n_yolo_only} none={n_none}")
    if args.out:
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
