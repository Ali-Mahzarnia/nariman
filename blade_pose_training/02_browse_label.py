"""Step 2 -- walk every frame and mark the handle's base and the direction it points.

    click 1   the base: the butt of the handle
    click 2   anywhere along the handle axis, pointing away from the base

The second click only sets a *direction*. It is snapped to a fixed radius from the base, so
it does not matter whether you can see 5 px of handle or all of it -- click along the axis
and the label is identical. Nothing about handle length reaches the model.

Angle is measured base -> direction, so the order is the label. A reversed arrow is a 180
degree error, not a small one. `w` flips it.

Occlusion is a *visibility flag* on the base, not a reason to skip. If a fist buries the
butt of the handle, put the base where you believe it is and press `v`. Ultralytics still
trains on it, which is what we want: the network should learn to infer a hidden base.
If you genuinely cannot tell where it is, press `n` and skip rather than guessing.

Unreviewed, positive, and negative are three different states. A *missing* label file means
you never looked. An *empty* file means you looked and there is no blade -- that is training
data, and it is what lets the model run at conf 0.5 instead of 0.08.

Keys
  navigation   n / b        next / previous frame        (--stride sets the jump)
               ] / [        +10 / -10 frames
               . / ,        +100 / -100 frames
               f            jump to next unreviewed frame  (in --review: next seeded frame)
  points       click        place the active point
               1 / 2        make base / direction active
               arrows       nudge base, or rotate the direction (loupe follows)
               g            cycle nudge step 1 -> 2 -> 5 -> 10 px
               w            reverse the arrow  (fixes a 180 deg error)
               v            toggle the BASE visible / occluded
               r            clear both points
  labeling     s            save as POSITIVE (needs both points)
               x            save as NEGATIVE (no blade)
               k            clear the label (back to unreviewed)
  proposals    p            re-run the model on this frame
  view         + / -        loupe zoom     m / h  move / hide loupe
               q            quit
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

from bladekit.core import (
    frame_name,
    load_json,
    pick_device,
    resolve_object,
    resolve_video,
    save_json,
)
from bladekit.kpts import (
    DIR_RADIUS_PX,
    KPT_NAMES,
    V_OCCLUDED,
    V_VISIBLE,
    angle_deg,
    is_negative_pose,
    kpts_to_bbox,
    normalize_dir,
    read_pose_label,
    write_pose_label,
)
from bladekit.ui import (
    CORNERS,
    KEY_DOWN,
    KEY_LEFT,
    KEY_RIGHT,
    KEY_UP,
    NUDGE_STEPS,
    draw_help,
    key_of,
)

COL = {"base": (0, 220, 255), "dir": (255, 160, 0)}
STATE_COLORS = {
    "unreviewed": (140, 140, 140),
    "positive": (0, 220, 0),
    "negative": (60, 60, 220),
}


class Marks:
    """The base, plus a direction snapped to a fixed radius around it.

    Every mutation re-snaps, so no edit can smuggle handle length into the label.
    """

    def __init__(self) -> None:
        self.pts: dict[str, list[float]] = {}
        self.base_vis = V_VISIBLE

    def clear(self) -> None:
        self.pts.clear()
        self.base_vis = V_VISIBLE

    def _snap(self) -> None:
        if self.complete():
            d = normalize_dir(np.array(self.pts["base"], np.float32),
                              np.array(self.pts["dir"], np.float32), DIR_RADIUS_PX)
            self.pts["dir"] = [float(d[0]), float(d[1])]

    def set(self, name: str, x: float, y: float) -> None:
        self.pts[name] = [float(x), float(y)]
        self._snap()

    def nudge(self, name: str, dx: float, dy: float, w: int, h: int) -> None:
        if name not in self.pts:
            return
        p = self.pts[name]
        self.pts[name] = [float(np.clip(p[0] + dx, 0, w - 1)), float(np.clip(p[1] + dy, 0, h - 1))]
        # Nudging the base carries the direction point with it; nudging the direction point
        # slides it off the circle and re-snapping turns that into a rotation.
        if name == "base" and "dir" in self.pts:
            self.pts["dir"] = [self.pts["dir"][0] + dx, self.pts["dir"][1] + dy]
        self._snap()

    def complete(self) -> bool:
        return all(n in self.pts for n in KPT_NAMES)

    def reverse(self) -> None:
        """Flip the arrow 180 degrees. The base stays put -- it is a real landmark; the
        direction point is virtual, so swapping the two would move the base onto a circle."""
        if not self.complete():
            return
        b = np.array(self.pts["base"], np.float32)
        d = np.array(self.pts["dir"], np.float32)
        self.pts["dir"] = (b - (d - b)).tolist()
        self._snap()

    def toggle_vis(self) -> None:
        self.base_vis = V_OCCLUDED if self.base_vis == V_VISIBLE else V_VISIBLE

    def arrays(self) -> tuple[np.ndarray, np.ndarray]:
        kps = np.array([self.pts[n] for n in KPT_NAMES], np.float32)
        return kps, np.array([self.base_vis, V_VISIBLE], np.int32)

    def load(self, kps: np.ndarray, vis: np.ndarray) -> None:
        self.clear()
        for i, n in enumerate(KPT_NAMES):
            self.pts[n] = [float(kps[i][0]), float(kps[i][1])]
        self.base_vis = int(vis[0]) if int(vis[0]) in (V_OCCLUDED, V_VISIBLE) else V_VISIBLE
        self._snap()

    def angle(self) -> float | None:
        return angle_deg(self.arrays()[0]) if self.complete() else None


def state_of(paths, stem: str) -> str:
    lab = paths.labels / f"{stem}.txt"
    if not lab.exists():
        return "unreviewed"
    return "negative" if is_negative_pose(lab) else "positive"


def draw_marks(view: np.ndarray, m: Marks, scale: float, active: str) -> None:
    if m.complete():
        b = np.array(m.pts["base"], np.float32)
        d = np.array(m.pts["dir"], np.float32)
        u = (d - b) / (np.linalg.norm(d - b) + 1e-9)
        # A long faint ray makes it easy to see whether the arrow lies along the handle,
        # even though only the fixed-radius segment is the label.
        far = b + u * 200
        cv2.line(view, tuple((b * scale).astype(int)), tuple((far * scale).astype(int)),
                 (0, 120, 0), 1, cv2.LINE_AA)
        cv2.arrowedLine(view, tuple((b * scale).astype(int)), tuple((d * scale).astype(int)),
                        (0, 255, 0), 2, cv2.LINE_AA, tipLength=0.25)
        box = kpts_to_bbox(m.arrays()[0]) * scale
        cv2.rectangle(view, (int(box[0]), int(box[1])), (int(box[2]), int(box[3])), (0, 160, 0), 1)
    for name in KPT_NAMES:
        if name not in m.pts:
            continue
        c = (int(m.pts[name][0] * scale), int(m.pts[name][1] * scale))
        if name == "base" and m.base_vis == V_OCCLUDED:
            cv2.circle(view, c, 7, COL[name], 2)  # hollow == occluded
        else:
            cv2.circle(view, c, 6 if name == "base" else 4, COL[name], -1)
        if name == active:
            cv2.circle(view, c, 11, (255, 255, 255), 2)


def draw_loupe(view, img, center, m: Marks, zoom, box, corner) -> None:
    h, w = img.shape[:2]
    ix, iy = int(center[0]), int(center[1])
    if not (0 <= ix < w and 0 <= iy < h):
        return
    crop = max(8, box // zoom)
    half = crop // 2
    x1, y1 = max(0, ix - half), max(0, iy - half)
    x2, y2 = min(w, ix + half), min(h, iy + half)
    patch = img[y1:y2, x1:x2]
    if patch.size == 0:
        return
    mag = cv2.resize(patch, (box, box), interpolation=cv2.INTER_NEAREST)
    sx, sy = box / max(1, x2 - x1), box / max(1, y2 - y1)
    if m.complete():
        pa, pb = m.pts["base"], m.pts["dir"]
        cv2.arrowedLine(mag, (int((pa[0] - x1) * sx), int((pa[1] - y1) * sy)),
                        (int((pb[0] - x1) * sx), int((pb[1] - y1) * sy)),
                        (0, 255, 0), 1, cv2.LINE_AA, tipLength=0.12)
    for name, p in m.pts.items():
        if x1 <= p[0] <= x2 and y1 <= p[1] <= y2:
            c = (int((p[0] - x1) * sx), int((p[1] - y1) * sy))
            if name == "base" and m.base_vis == V_OCCLUDED:
                cv2.circle(mag, c, 6, COL[name], 2)
            else:
                cv2.circle(mag, c, 5, COL[name], -1)
    cx, cy = int((ix - x1) * sx), int((iy - y1) * sy)
    cv2.line(mag, (cx, 0), (cx, box - 1), (0, 255, 255), 1)
    cv2.line(mag, (0, cy), (box - 1, cy), (0, 255, 255), 1)
    cv2.rectangle(mag, (0, 0), (box - 1, box - 1), (0, 255, 0), 2)
    vh, vw = view.shape[:2]
    mx, my = {0: (vw - box - 10, vh - box - 10), 1: (10, vh - box - 10),
              2: (10, 10), 3: (vw - box - 10, 10)}[corner % 4]
    mx, my = max(0, mx), max(0, my)
    view[my : my + box, mx : mx + box] = mag[: vh - my, : vw - mx]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--video", type=Path, required=True)
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--stride", type=int, default=1)
    ap.add_argument("--review", action="store_true",
                    help="Visit already-labeled frames (to check seeded base/neck order).")
    ap.add_argument("--propose", type=Path, default=None, help="Weights to pre-fill keypoints.")
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--crop", type=int, default=320)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--max-width", type=int, default=1400)
    ap.add_argument("--zoom", type=int, default=8)
    ap.add_argument("--loupe", type=int, default=300)
    ap.add_argument("--loupe-corner", type=int, default=0, choices=[0, 1, 2, 3])
    args = ap.parse_args()

    paths = resolve_object(args.object)
    video = resolve_video(paths, args.video)
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise SystemExit(f"Could not open video: {video}")
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0

    detector = None
    if args.propose:
        from ultralytics import YOLO

        from bladekit.infer import CropDetector

        if not args.propose.exists():
            raise SystemExit(f"Weights not found: {args.propose}")
        detector = CropDetector(YOLO(str(args.propose)), args.crop, args.imgsz, args.conf, pick_device())
        print(f"proposals from {args.propose}")

    m = Marks()
    active = "base"
    step_idx = 0
    zoom, corner, show_loupe = args.zoom, args.loupe_corner, True
    mouse = {"x": 0.0, "y": 0.0}
    on_point = {"v": False}
    idx = max(0, min(args.start, max(0, total - 1)))
    frame = None
    proposed = False
    scale_ref = [1.0]
    win = f"02 keypoints - {video.name}"

    def on_mouse(event, x, y, _f, _p):
        nonlocal active
        ix, iy = x / scale_ref[0], y / scale_ref[0]
        mouse["x"], mouse["y"] = ix, iy
        if event == cv2.EVENT_MOUSEMOVE:
            on_point["v"] = False
        elif event == cv2.EVENT_LBUTTONDOWN:
            m.set(active, ix, iy)
            on_point["v"] = False
            if active == "base" and "dir" not in m.pts:
                active = "dir"  # base then direction, without reaching for a key

    cv2.namedWindow(win)
    cv2.setMouseCallback(win, on_mouse)

    def propose_into(frame_img) -> bool:
        if detector is None:
            return False
        det = detector.detect(frame_img)
        if len(det) == 0 or det.kpts is None:
            return False
        best = det.best()
        kps = best.kpts[0][:, :2]
        vis = np.where(best.kpts[0][:, 2] > 0.5, V_VISIBLE, V_OCCLUDED)
        m.load(kps, vis)
        return True

    def load_frame(i: int) -> None:
        nonlocal frame, proposed, active
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, frame = cap.read()
        proposed = False
        active = "base"
        if not ok or frame is None:
            return
        stem = frame_name(video, i)
        h, w = frame.shape[:2]
        lab = paths.labels / f"{stem}.txt"
        existing = read_pose_label(lab, w, h)
        if existing:
            m.load(*existing[0])
            return
        m.clear()
        if not lab.exists() and detector is not None:
            proposed = propose_into(frame)

    def next_matching(start: int) -> int:
        for i in range(start + 1, total):
            lab = paths.labels / f"{frame_name(video, i)}.txt"
            hit = lab.exists() and not is_negative_pose(lab) if args.review else not lab.exists()
            if hit:
                return i
        return start

    load_frame(idx)
    while True:
        if frame is None:
            print(f"could not read frame {idx}")
            break
        h, w = frame.shape[:2]
        scale = min(1.0, args.max_width / w)
        scale_ref[0] = scale
        stem = frame_name(video, idx)
        st = state_of(paths, stem)

        view = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale != 1.0 else frame.copy()
        draw_marks(view, m, scale, active)

        n_rev = len(list(paths.labels.glob("*.txt")))
        ang = m.angle()
        base_txt = "base:VISIBLE" if m.base_vis == V_VISIBLE else "base:OCCLUDED"
        draw_help(view, [
            f"frame {idx}/{max(0, total - 1)}   [{st.upper()}]" + ("  (proposed)" if proposed else ""),
            "n/b step  ]/[ 10  ,/. 100  f next   s=save  x=negative  k=clear  q=quit",
            f"active={active} (1/2)  click=place  arrows=nudge/rotate  g=step({NUDGE_STEPS[step_idx]}px)  "
            f"w=reverse  v=occluded  r=clear",
            (f"angle = {ang:.1f} deg   {base_txt}" if ang is not None
             else "click the BASE, then click along the handle (direction only)"),
            f"reviewed={n_rev}   loupe={CORNERS[corner % 4] if show_loupe else 'hidden'} (m/h)",
        ])
        cv2.rectangle(view, (0, 0), (view.shape[1] - 1, view.shape[0] - 1), STATE_COLORS[st], 3)
        if show_loupe:
            focus = m.pts[active] if (on_point["v"] and active in m.pts) else (mouse["x"], mouse["y"])
            draw_loupe(view, frame, focus, m, zoom, args.loupe, corner)
        cv2.imshow(win, view)

        code = cv2.waitKeyEx(20)
        if code == -1:
            continue

        if code in (KEY_LEFT | KEY_RIGHT | KEY_UP | KEY_DOWN) and active in m.pts:
            d = NUDGE_STEPS[step_idx]
            dx = -d if code in KEY_LEFT else (d if code in KEY_RIGHT else 0)
            dy = -d if code in KEY_UP else (d if code in KEY_DOWN else 0)
            m.nudge(active, dx, dy, w, h)
            on_point["v"] = True
            continue

        k = key_of(code)
        if k == ord("q"):
            break
        elif k == ord("1"):
            active = "base"
        elif k == ord("2"):
            active = "dir"
        elif k == ord("g"):
            step_idx = (step_idx + 1) % len(NUDGE_STEPS)
        elif k == ord("w"):
            m.reverse()
        elif k == ord("v"):
            m.toggle_vis()
        elif k == ord("r"):
            m.clear()
        elif k == ord("n"):
            idx = min(total - 1, idx + args.stride)
            load_frame(idx)
        elif k == ord("b"):
            idx = max(0, idx - args.stride)
            load_frame(idx)
        elif k == ord("]"):
            idx = min(total - 1, idx + 10)
            load_frame(idx)
        elif k == ord("["):
            idx = max(0, idx - 10)
            load_frame(idx)
        elif k == ord("."):
            idx = min(total - 1, idx + 100)
            load_frame(idx)
        elif k == ord(","):
            idx = max(0, idx - 100)
            load_frame(idx)
        elif k == ord("f"):
            idx = next_matching(idx)
            load_frame(idx)
        elif k == ord("s"):
            if not m.complete():
                print("need BOTH points (or press x for a negative)")
                continue
            cv2.imwrite(str(paths.frames / f"{stem}.jpg"), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 98])
            write_pose_label(paths.labels / f"{stem}.txt", [m.arrays()], w, h)
            print(f"{stem}: positive  angle={m.angle():.1f}deg")
            idx = min(total - 1, idx + args.stride)
            load_frame(idx)
        elif k == ord("x"):
            cv2.imwrite(str(paths.frames / f"{stem}.jpg"), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 98])
            write_pose_label(paths.labels / f"{stem}.txt", [], w, h)
            print(f"{stem}: negative")
            idx = min(total - 1, idx + args.stride)
            load_frame(idx)
        elif k == ord("k"):
            (paths.labels / f"{stem}.txt").unlink(missing_ok=True)
            (paths.frames / f"{stem}.jpg").unlink(missing_ok=True)
            m.clear()
            print(f"{stem}: cleared")
        elif k == ord("p") and detector is not None:
            if propose_into(frame):
                proposed = True
                print(f"proposal angle={m.angle():.1f}deg")
            else:
                print("no proposal above conf")
        elif k == ord("m"):
            corner = (corner + 1) % 4
        elif k == ord("h"):
            show_loupe = not show_loupe
        elif k in (ord("+"), ord("=")):
            zoom = min(14, zoom + 1)
        elif k in (ord("-"), ord("_")):
            zoom = max(2, zoom - 1)

    cap.release()
    cv2.destroyAllWindows()
    labs = sorted(paths.labels.glob("*.txt"))
    pos = sum(1 for p in labs if not is_negative_pose(p))
    print(f"\nreviewed={len(labs)}  positive={pos}  negative={len(labs) - pos}")
    print(f"Next: python 03_set_scale.py --object {args.object}")


if __name__ == "__main__":
    main()
