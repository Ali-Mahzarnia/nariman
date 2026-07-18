"""Test: does the model need to predict kp1 (direction) at all, every frame -- or is base (kp0)
+ LSD + frame-to-frame continuity enough? Uses the SAME already-trained model; no retrain.

CYAN   = current approach: YOLO gives coarse angle from kp1 EVERY frame, LSD refines it
GREEN  = experimental: YOLO's kp1 used ONLY on frame 0 to bootstrap direction; every frame
         after that, the "coarse angle" fed to LSD is just the previous frame's resolved
         angle (continuity), never touching kp1 again. If GREEN tracks CYAN closely, kp1
         is not pulling its weight after initialization.

If GREEN drifts badly or loses lock for good after occlusion (no kp1 to re-bootstrap from),
that's the cost of dropping it -- worth seeing directly before deciding.

    PY=.venv/bin/python
    $PY base_only_test.py --object objects/blade1 --video objects/blade1/videos/test3.mp4 \
        --weights objects/blade1/runs/train/clean/weights/last.pt
"""
import argparse

import cv2
import numpy as np
from ultralytics import YOLO

from lsd_refine import AngleSmoother, CROP, IMGSZ, clamp_crop, lsd_refine


def yolo_predict_full(model, frame, cx, cy, conf):
    h, w = frame.shape[:2]
    x, y = clamp_crop(cx, cy, w, h)
    patch = frame[y:y + CROP, x:x + CROP]
    r = model.predict(patch, imgsz=IMGSZ, conf=conf, device="cpu", verbose=False)[0]
    if r.keypoints is None or len(r.keypoints.data) == 0:
        return None
    i = int(r.boxes.conf.argmax())
    kp = r.keypoints.data.cpu().numpy()[i][:, :2] + np.array([x, y], np.float32)
    return kp[0], kp[1], float(r.boxes.conf[i])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--video", required=True)
    ap.add_argument("--weights", required=True)
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--out", default=None)
    ap.add_argument("--reacquire-after", type=int, default=25,
                    help="frames with no GREEN reading before falling back to kp1 again")
    args = ap.parse_args()

    model = YOLO(args.weights)
    cap = cv2.VideoCapture(args.video)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

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
            roi_center = ((st["a"][0] + st["b"][0]) // 2, (st["a"][1] + st["b"][1]) // 2)
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
    cyan_smoother = AngleSmoother(alpha=0.35, max_turn_deg=30.0)
    green_smoother = AngleSmoother(alpha=0.35, max_turn_deg=30.0)
    green_angle = None       # last resolved GREEN angle (continuity source)
    green_misses = 0         # consecutive frames GREEN has had no LSD reading

    for idx in range(total):
        ok, frame = cap.read()
        if not ok:
            break
        det = yolo_predict_full(model, frame, track[0], track[1], args.conf)
        vis = frame.copy()
        if det is not None:
            base, tip, conf = det
            track = (int(base[0]), int(base[1]))
            kp1_coarse_angle = float(np.degrees(np.arctan2(tip[1] - base[1], tip[0] - base[0])))
            bx, by = int(base[0]), int(base[1])

            # CYAN: existing approach, kp1 used every frame
            cref = lsd_refine(frame, base, kp1_coarse_angle)
            if cref is not None:
                cyan_angle = cyan_smoother.update(cref[0])
            elif cyan_smoother.vec is not None:
                cyan_angle = float(np.degrees(np.arctan2(*cyan_smoother.vec[::-1])))
            else:
                cyan_angle = None
            if cyan_angle is not None:
                cx = int(bx + 90 * np.cos(np.radians(cyan_angle)))
                cy = int(by + 90 * np.sin(np.radians(cyan_angle)))
                cv2.line(vis, (bx, by), (cx, cy), (255, 255, 0), 1, cv2.LINE_8)

            # GREEN: kp1 only bootstraps frame 0, or after a long stretch of no lock
            if green_angle is None or green_misses > args.reacquire_after:
                prior = kp1_coarse_angle
            else:
                prior = green_angle
            gref = lsd_refine(frame, base, prior)
            if gref is not None:
                green_angle = green_smoother.update(gref[0])
                green_misses = 0
            else:
                green_misses += 1
                if green_smoother.vec is not None:
                    green_angle = float(np.degrees(np.arctan2(*green_smoother.vec[::-1])))
            if green_angle is not None:
                gx = int(bx + 70 * np.cos(np.radians(green_angle)))
                gy = int(by + 70 * np.sin(np.radians(green_angle)))
                cv2.line(vis, (bx, by), (gx, gy), (0, 255, 0), 1, cv2.LINE_8)

            vis[by, bx] = (0, 0, 255)
            cv2.putText(vis, f"f{idx}/{total}  CYAN(kp1 every frame) GREEN(kp1 once)",
                        (6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
        else:
            cv2.putText(vis, f"f{idx}/{total}  NO DETECTION", (6, 16),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)

        if writer:
            writer.write(vis)

    if writer:
        writer.release()
    cap.release()
    if args.out:
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
