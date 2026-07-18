"""Interactive predict-and-relabel tool for fine-tuning the blade pose models.

Walks a long deployment video frame by frame (every --stride frames). On each frame it
crops a 320 window that tracks the blade, runs the CURRENT model, and draws the base plus a
thin direction line. You correct the angle with the mouse wheel (or the , . keys), then press
`s` to SAVE that frame as a new positive training example, or `n`/SPACE to skip it. Only
frames you save are written -- no negatives.

Saved frames land in the object's own frames/ and labels/ dirs with an `ft_` prefix, so they
mix straight into the existing training set when you rebuild the dataset.

    PY=.venv/bin/python
    $PY label_finetune.py --object objects/blade1 --video longs/long_blade1.mp4

Controls (focus the OpenCV window):
    mouse wheel / , .   rotate the direction  (-/+ 0.5 deg; hold with < > keys for +/-2 deg)
    left click          place the base here (also recenters the tracking crop)
    r                   reset angle+base to the model's prediction for this frame
    b                   flip direction 180 deg (fixes a base<->tip swap)
    s                   SAVE this frame as a positive, advance
    n / SPACE           skip this frame (save nothing), advance
    p                   go back one step
    q / ESC             quit (progress is on disk already)
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

from bladekit.core import resolve_object
from bladekit.kpts import DIR_RADIUS_PX, V_VISIBLE, write_pose_label

CROP = 320
IMGSZ = 640
LINE_LEN = 130  # display length of the direction line, px (label always uses DIR_RADIUS_PX)
LOUPE_SRC = 90  # side of the source region the loupe magnifies, px
LOUPE_OUT = 260  # side of the loupe inset drawn in the corner, px


def clamp_crop(cx: int, cy: int, w: int, h: int) -> tuple[int, int]:
    x = int(np.clip(cx - CROP // 2, 0, max(0, w - CROP)))
    y = int(np.clip(cy - CROP // 2, 0, max(0, h - CROP)))
    return x, y


def predict(model, frame, cx, cy, conf):
    """Return (base_xy, angle_deg, conf, (x, y)) in full-frame px, or None if nothing found."""
    h, w = frame.shape[:2]
    x, y = clamp_crop(cx, cy, w, h)
    patch = frame[y : y + CROP, x : x + CROP]
    r = model.predict(patch, imgsz=IMGSZ, conf=conf, device="cpu", verbose=False)[0]
    if r.keypoints is None or len(r.keypoints.data) == 0:
        return None
    i = int(r.boxes.conf.argmax())
    kp = r.keypoints.data.cpu().numpy()[i][:, :2] + np.array([x, y], np.float32)
    d = kp[1] - kp[0]
    ang = float(np.degrees(np.arctan2(d[1], d[0])))
    return kp[0].astype(np.float32), ang, float(r.boxes.conf[i]), (x, y)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--video", required=True)
    ap.add_argument("--stride", type=int, default=10, help="frames to advance per step")
    ap.add_argument("--conf", type=float, default=0.35)
    ap.add_argument("--start", type=int, default=0, help="first frame index")
    ap.add_argument("--weights", default=None,
                    help="model weights to run; default is the original runs/train/blade")
    args = ap.parse_args()

    paths = resolve_object(args.object)
    frames_dir, labels_dir = paths.frames, paths.labels
    frames_dir.mkdir(parents=True, exist_ok=True)
    labels_dir.mkdir(parents=True, exist_ok=True)

    weights = args.weights or str(paths.runs / "train/blade/weights/last.pt")
    print(f"model: {weights}")
    model = YOLO(weights)

    cap = cv2.VideoCapture(args.video)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # mutable UI state carried across frames
    st = {"base": None, "angle": 0.0, "track": (W // 2, H // 2),
          "mouse": (W // 2, H // 2), "drag": False, "dbg": "scroll the wheel"}

    def set_angle_to(mx, my):
        b = st["base"]
        if b is not None and np.hypot(mx - b[0], my - b[1]) > 3:
            st["angle"] = float(np.degrees(np.arctan2(my - b[1], mx - b[0])))

    def on_mouse(event, mx, my, flags, _):
        if event == cv2.EVENT_LBUTTONDOWN:
            st["base"] = np.array([mx, my], np.float32)   # click = drop base here
            st["track"] = (mx, my)
            st["mouse"] = (mx, my)
            st["drag"] = True
        elif event == cv2.EVENT_MOUSEMOVE:
            st["mouse"] = (mx, my)
            if st["drag"]:
                set_angle_to(mx, my)                       # drag toward tip = aim
        elif event == cv2.EVENT_LBUTTONUP:
            set_angle_to(mx, my)
            st["drag"] = False
        elif event == cv2.EVENT_MOUSEWHEEL:
            delta = (flags >> 16) & 0xFFFF
            if delta >= 0x8000:
                delta -= 0x10000
            st["dbg"] = f"WHEEL raw_flags={flags}  hi_word={delta}"
            st["angle"] += 0.5 if delta > 0 else -0.5

    win = f"label {Path(args.video).stem}"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(win, W, H)
    cv2.setMouseCallback(win, on_mouse)

    idx = args.start
    saved = 0
    need_predict = True

    while 0 <= idx < total:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            break

        if need_predict:
            tcx, tcy = st["track"]
            det = predict(model, frame, tcx, tcy, args.conf)
            if det is not None:
                base, ang, dconf, _ = det
                st["base"], st["angle"] = base, ang
                st["track"] = (int(base[0]), int(base[1]))
            else:
                dconf = 0.0
                st["base"] = None  # let user click one in
            need_predict = False

        # ---- advance one step (predict for the new frame), waiting on a key ----
        while True:
            vis = frame.copy()
            tcx, tcy = st["track"]
            x, y = clamp_crop(tcx, tcy, W, H)
            cv2.rectangle(vis, (x, y), (x + CROP, y + CROP), (90, 90, 90), 1)

            if st["base"] is not None:
                bx, by = int(st["base"][0]), int(st["base"][1])
                a = np.radians(st["angle"])
                ex, ey = int(bx + LINE_LEN * np.cos(a)), int(by + LINE_LEN * np.sin(a))
                cv2.line(vis, (bx, by), (ex, ey), (0, 255, 0), 1, cv2.LINE_AA)  # thin line
                cv2.circle(vis, (bx, by), 1, (0, 0, 255), -1)
                status = f"angle {st['angle']:+6.1f}  conf {dconf:.2f}"
            else:
                status = "NO DETECTION - left-click the base, wheel to aim"

            # ---- magnifier loupe following the cursor, drawn bottom-right ----
            mx, my = st["mouse"]
            half = LOUPE_SRC // 2
            sx = int(np.clip(mx - half, 0, W - LOUPE_SRC))
            sy = int(np.clip(my - half, 0, H - LOUPE_SRC))
            src = vis[sy : sy + LOUPE_SRC, sx : sx + LOUPE_SRC]
            if src.shape[:2] == (LOUPE_SRC, LOUPE_SRC):
                loupe = cv2.resize(src, (LOUPE_OUT, LOUPE_OUT), interpolation=cv2.INTER_NEAREST)
                z = LOUPE_OUT / LOUPE_SRC
                cx = int((mx - sx) * z); cy = int((my - sy) * z)
                cv2.line(loupe, (cx, 0), (cx, LOUPE_OUT), (0, 255, 255), 1)
                cv2.line(loupe, (0, cy), (LOUPE_OUT, cy), (0, 255, 255), 1)
                cv2.rectangle(loupe, (0, 0), (LOUPE_OUT - 1, LOUPE_OUT - 1), (255, 255, 255), 1)
                px, py = W - LOUPE_OUT - 6, H - LOUPE_OUT - 6
                vis[py : py + LOUPE_OUT, px : px + LOUPE_OUT] = loupe

            hud = f"f{idx}/{total}  stride {args.stride}  saved {saved}  |  {status}   [ ] rotate"
            cv2.rectangle(vis, (0, 0), (W, 22), (0, 0, 0), -1)
            cv2.putText(vis, hud, (6, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            cv2.imshow(win, vis)

            k = cv2.waitKey(20) & 0xFF
            if k == 255:
                continue
            if k in (ord("q"), 27):
                cap.release(); cv2.destroyAllWindows()
                print(f"quit at frame {idx}. saved {saved} positives to {labels_dir}")
                return
            if k in (ord(","), ord("[")):
                st["angle"] -= 0.5
            elif k in (ord("."), ord("]")):
                st["angle"] += 0.5
            elif k == ord("<"):
                st["angle"] -= 2.0
            elif k == ord(">"):
                st["angle"] += 2.0
            elif k == ord("b"):
                st["angle"] = (st["angle"] + 180.0 + 180.0) % 360.0 - 180.0
            elif k == ord("r"):
                need_predict = True
                break  # re-run prediction on same frame
            elif k == ord("p"):
                idx = max(args.start, idx - args.stride)
                need_predict = True
                break
            elif k == ord("s") and st["base"] is not None:
                stem = f"ft_{Path(args.video).stem}_f{idx:06d}"
                cv2.imwrite(str(frames_dir / f"{stem}.jpg"), frame)
                a = np.radians(st["angle"])
                dirpt = st["base"] + np.array([np.cos(a), np.sin(a)], np.float32) * DIR_RADIUS_PX
                kps = np.stack([st["base"], dirpt]).astype(np.float32)
                vis_flags = np.array([V_VISIBLE, V_VISIBLE], np.int32)
                write_pose_label(labels_dir / f"{stem}.txt", [(kps, vis_flags)], W, H)
                saved += 1
                idx += args.stride
                need_predict = True
                break
            elif k in (ord("n"), ord(" ")):
                idx += args.stride
                need_predict = True
                break

    cap.release()
    cv2.destroyAllWindows()
    print(f"done. saved {saved} positives to {labels_dir}")


if __name__ == "__main__":
    main()
