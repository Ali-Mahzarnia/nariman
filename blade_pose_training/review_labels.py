"""Review and correct existing saved labels before a retrain -- no video, no model, just
what's already on disk in frames/ + labels/. Walks every POSITIVE labeled frame, draws the
stored base + direction, and lets you fix it in place.

    PY=.venv/bin/python
    $PY review_labels.py --object objects/blade1
    $PY review_labels.py --object objects/blade1 --prefix ft_   # only your relabeled ones

Controls (focus the window):
    mouse wheel / [ ]   rotate the direction  (-/+ 0.5 deg)
    left click + drag   move the base, aim the drag toward the true tip, release to set
    b                    flip 180 deg
    r                    reload this frame's original saved label (undo edits since arriving)
    s                    SAVE (overwrite the label file) and go to next
    n / SPACE            next WITHOUT saving (skip -- leaves the file untouched)
    p                    previous frame
    q / ESC              quit
"""

from __future__ import annotations

import argparse

import cv2
import numpy as np

from bladekit.core import resolve_object
from bladekit.kpts import V_VISIBLE, angle_deg, read_pose_label, write_pose_label

DISPLAY_LEN = 90.0  # visualization only -- independent of the stored kp1 radius
LOUPE_SRC = 45
LOUPE_OUT = 300  # ~6.7x zoom, window stays a readable size


def load_frames(paths, prefix: str | None):
    out = []
    for f in sorted(paths.frames.glob("*.jpg")):
        if prefix and not f.stem.startswith(prefix):
            continue
        lab = paths.labels / f"{f.stem}.txt"
        if lab.exists() and lab.read_text().strip():
            out.append(f)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--prefix", default=None, help="only review frames whose stem starts with this, e.g. ft_")
    ap.add_argument("--start", type=int, default=0)
    args = ap.parse_args()

    paths = resolve_object(args.object)
    frames = load_frames(paths, args.prefix)
    if not frames:
        raise SystemExit("no positive labeled frames found")
    print(f"{len(frames)} labeled frames to review")

    st = {"base": None, "angle": 0.0, "mouse": (0, 0), "drag": False, "changed": False}

    def load(i: int):
        f = frames[i]
        img = cv2.imread(str(f))
        h, w = img.shape[:2]
        entries = read_pose_label(paths.labels / f"{f.stem}.txt", w, h)
        kps, vis = entries[0]
        st["base"] = kps[0].astype(np.float32)
        st["angle"] = angle_deg(kps)
        st["vis"] = vis
        st["changed"] = False
        return img, w, h

    def set_angle_to(mx, my):
        b = st["base"]
        if b is not None and np.hypot(mx - b[0], my - b[1]) > 3:
            st["angle"] = float(np.degrees(np.arctan2(my - b[1], mx - b[0])))
            st["changed"] = True

    def on_mouse(event, mx, my, flags, _):
        if event == cv2.EVENT_LBUTTONDOWN:
            st["base"] = np.array([mx, my], np.float32)
            st["mouse"] = (mx, my)
            st["drag"] = True
            st["changed"] = True
        elif event == cv2.EVENT_MOUSEMOVE:
            st["mouse"] = (mx, my)
            if st["drag"]:
                set_angle_to(mx, my)
        elif event == cv2.EVENT_LBUTTONUP:
            set_angle_to(mx, my)
            st["drag"] = False
        elif event == cv2.EVENT_MOUSEWHEEL:
            delta = (flags >> 16) & 0xFFFF
            if delta >= 0x8000:
                delta -= 0x10000
            st["angle"] += 0.5 if delta > 0 else -0.5
            st["changed"] = True

    win = "review labels"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(win, on_mouse)

    i = max(0, min(args.start, len(frames) - 1))
    img, W, H = load(i)
    saved = 0

    while True:
        vis_img = img.copy()
        bx, by = int(st["base"][0]), int(st["base"][1])
        a = np.radians(st["angle"])
        ex, ey = int(bx + DISPLAY_LEN * np.cos(a)), int(by + DISPLAY_LEN * np.sin(a))
        cv2.line(vis_img, (bx, by), (ex, ey), (0, 255, 0), 1, cv2.LINE_8)  # no AA blur = crisper hairline
        if 0 <= by < vis_img.shape[0] and 0 <= bx < vis_img.shape[1]:
            vis_img[by, bx] = (0, 0, 255)  # true single-pixel dot, no circle blob

        mx, my = st["mouse"]
        half = LOUPE_SRC // 2
        sx = int(np.clip(mx - half, 0, W - LOUPE_SRC))
        sy = int(np.clip(my - half, 0, H - LOUPE_SRC))
        src = vis_img[sy:sy + LOUPE_SRC, sx:sx + LOUPE_SRC]
        if src.shape[:2] == (LOUPE_SRC, LOUPE_SRC):
            loupe = cv2.resize(src, (LOUPE_OUT, LOUPE_OUT), interpolation=cv2.INTER_NEAREST)
            z = LOUPE_OUT / LOUPE_SRC
            cx, cy = int((mx - sx) * z), int((my - sy) * z)
            cv2.line(loupe, (cx, 0), (cx, LOUPE_OUT), (0, 255, 255), 1)
            cv2.line(loupe, (0, cy), (LOUPE_OUT, cy), (0, 255, 255), 1)
            cv2.rectangle(loupe, (0, 0), (LOUPE_OUT - 1, LOUPE_OUT - 1), (255, 255, 255), 1)
            px, py = W - LOUPE_OUT - 6, H - LOUPE_OUT - 6
            vis_img[py:py + LOUPE_OUT, px:px + LOUPE_OUT] = loupe

        mark = "EDITED" if st["changed"] else ""
        hud = f"{i+1}/{len(frames)}  {frames[i].stem}  angle {st['angle']:+6.1f}  saved {saved}  {mark}"
        cv2.rectangle(vis_img, (0, 0), (W, 22), (0, 0, 0), -1)
        cv2.putText(vis_img, hud, (6, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
        cv2.imshow(win, vis_img)

        k = cv2.waitKey(20) & 0xFF
        if k == 255:
            continue
        if k in (ord("q"), 27):
            break
        elif k == ord("["):
            st["angle"] -= 0.5; st["changed"] = True
        elif k == ord("]"):
            st["angle"] += 0.5; st["changed"] = True
        elif k == ord("b"):
            st["angle"] = (st["angle"] + 180.0 + 180.0) % 360.0 - 180.0
            st["changed"] = True
        elif k == ord("r"):
            img, W, H = load(i)
        elif k == ord("s"):
            kps = np.stack([st["base"], st["base"] + np.array(
                [np.cos(np.radians(st["angle"])), np.sin(np.radians(st["angle"]))], np.float32
            ) * 24.0]).astype(np.float32)  # DIR_RADIUS_PX baked in at write time by write_pose_label's caller
            from bladekit.kpts import DIR_RADIUS_PX, normalize_pair
            kps = normalize_pair(np.stack([st["base"], st["base"] + np.array(
                [np.cos(np.radians(st["angle"])), np.sin(np.radians(st["angle"]))], np.float32) * DIR_RADIUS_PX]))
            write_pose_label(paths.labels / f"{frames[i].stem}.txt", [(kps, st["vis"])], W, H)
            saved += 1
            i = min(i + 1, len(frames) - 1)
            img, W, H = load(i)
        elif k in (ord("n"), ord(" ")):
            i = min(i + 1, len(frames) - 1)
            img, W, H = load(i)
        elif k == ord("p"):
            i = max(i - 1, 0)
            img, W, H = load(i)

    cv2.destroyAllWindows()
    print(f"reviewed. saved {saved} corrections to {paths.labels}")


if __name__ == "__main__":
    main()
