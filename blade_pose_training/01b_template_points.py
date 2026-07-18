"""Step 1b -- click the base and the handle direction on each traced cutout.

Two clicks per cutout, and every synthetic image you ever generate gets its keypoints for
free: we place the template with a known rotation, scale, flip and offset, so the same
affine that moves the pixels moves these two points. The synthetic labels are exact, not
estimated -- which is the entire reason the keypoint pipeline beats segmentation here.

    base  the butt of the handle, the end furthest from the blade head
    dir   any point further up the handle axis -- it only sets a direction

Angle is always measured base -> dir, so getting the order right matters. The overlay draws
an arrow so you can see it.

Keys
  click            place the active point (base first, then direction)
  1 / 2            make base / direction the active point
  arrows           nudge the active point (loupe follows it)
  g                cycle nudge step 1 -> 2 -> 5 -> 10 px
  f                reverse the arrow
  n / b            next / previous cutout
  s                save all cutouts' points
  + / -            loupe zoom     m / h  move / hide loupe
  q                quit without saving
"""

from __future__ import annotations

import argparse

import cv2
import numpy as np

from bladekit.core import load_json, resolve_object, save_json
from bladekit.kpts import KPT_NAMES, TEMPLATE_ALIASES, angle_deg
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


def load_cutouts(paths):
    cuts = []
    for p in sorted(paths.cutouts.glob("*.png")):
        if p.name.endswith("_mask.png"):
            continue
        img = cv2.imread(str(p), cv2.IMREAD_UNCHANGED)
        if img is not None and img.ndim == 3 and img.shape[2] == 4:
            cuts.append((p.name, img))
    if not cuts:
        raise SystemExit(f"No RGBA cutouts in {paths.cutouts}. Run 01_cut_template.py first.")
    return cuts


def checkerboard(h: int, w: int, size: int = 12) -> np.ndarray:
    """So a dark handle on a transparent background stays visible."""
    board = np.zeros((h, w, 3), np.uint8)
    board[:] = 90
    ys, xs = np.mgrid[0:h, 0:w]
    board[((ys // size) + (xs // size)) % 2 == 0] = 130
    return board


def compose(rgba: np.ndarray) -> np.ndarray:
    h, w = rgba.shape[:2]
    a = (rgba[:, :, 3:4].astype(np.float32) / 255.0)
    bg = checkerboard(h, w).astype(np.float32)
    return np.clip(rgba[:, :, :3].astype(np.float32) * a + bg * (1 - a), 0, 255).astype(np.uint8)


def draw_points(view: np.ndarray, pts: dict, scale: float, active: str) -> None:
    if "base" in pts and "dir" in pts:
        a = (int(pts["base"][0] * scale), int(pts["base"][1] * scale))
        b = (int(pts["dir"][0] * scale), int(pts["dir"][1] * scale))
        cv2.arrowedLine(view, a, b, (0, 255, 0), 2, cv2.LINE_AA, tipLength=0.12)
    for name in KPT_NAMES:
        if name not in pts:
            continue
        c = (int(pts[name][0] * scale), int(pts[name][1] * scale))
        cv2.circle(view, c, 7, COL[name], -1)
        if name == active:
            cv2.circle(view, c, 11, (255, 255, 255), 2)
        cv2.putText(view, name, (c[0] + 12, c[1] - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                    COL[name], 2, cv2.LINE_AA)


def loupe(view, img, center, pts, zoom, box, corner, scale) -> None:
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
    for name, p in pts.items():
        if x1 <= p[0] <= x2 and y1 <= p[1] <= y2:
            cv2.circle(mag, (int((p[0] - x1) * sx), int((p[1] - y1) * sy)), 6, COL[name], -1)
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
    ap.add_argument("--max-width", type=int, default=1100)
    ap.add_argument("--zoom", type=int, default=6)
    ap.add_argument("--loupe", type=int, default=280)
    args = ap.parse_args()

    paths = resolve_object(args.object)
    cutouts = load_cutouts(paths)
    store = load_json(paths.meta / "template_points.json")
    # Files written before kp1 became a virtual direction point say "neck".
    for entry in store.values():
        for old, new in TEMPLATE_ALIASES.items():
            if old in entry:
                entry[new] = entry.pop(old)

    idx = 0
    active = "base"
    step_idx = 0
    zoom = args.zoom
    corner = 0
    show_loupe = True
    mouse = {"x": 0.0, "y": 0.0}
    on_point = {"v": False}
    win = "01b template points"
    cv2.namedWindow(win)

    scale_ref = [1.0]

    def on_mouse(event, x, y, _f, _p):
        ix, iy = x / scale_ref[0], y / scale_ref[0]
        mouse["x"], mouse["y"] = ix, iy
        if event == cv2.EVENT_MOUSEMOVE:
            on_point["v"] = False
        elif event == cv2.EVENT_LBUTTONDOWN:
            name, img = cutouts[idx]
            store.setdefault(name, {})[active] = [float(ix), float(iy)]
            on_point["v"] = False

    cv2.setMouseCallback(win, on_mouse)

    while True:
        name, rgba = cutouts[idx]
        base_img = compose(rgba)
        h, w = base_img.shape[:2]
        scale = min(1.0, args.max_width / w)
        scale_ref[0] = scale
        pts = {k: v for k, v in store.get(name, {}).items() if k in KPT_NAMES}

        view = cv2.resize(base_img, (int(w * scale), int(h * scale))) if scale != 1.0 else base_img.copy()
        draw_points(view, pts, scale, active)

        ang = angle_deg(np.array([pts["base"], pts["dir"]])) if len(pts) == 2 else None
        done = sum(1 for n, _ in cutouts if len(store.get(n, {})) == 2)
        draw_help(view, [
            f"cutout {idx + 1}/{len(cutouts)}: {name}   [{done}/{len(cutouts)} done]",
            f"active={active} (1=base 2=dir)  click=place  arrows=nudge  g=step({NUDGE_STEPS[step_idx]}px)",
            f"f=reverse  n/b=cutout  s=save  q=quit   loupe={CORNERS[corner % 4] if show_loupe else 'hidden'}",
            f"angle base->dir = {ang:.1f} deg" if ang is not None else "place BOTH points",
        ])
        if show_loupe:
            focus = pts[active] if (on_point["v"] and active in pts) else (mouse["x"], mouse["y"])
            loupe(view, base_img, focus, pts, zoom, args.loupe, corner, scale)
        cv2.imshow(win, view)

        code = cv2.waitKeyEx(20)
        if code == -1:
            continue

        if code in (KEY_LEFT | KEY_RIGHT | KEY_UP | KEY_DOWN) and active in pts:
            d = NUDGE_STEPS[step_idx]
            dx = -d if code in KEY_LEFT else (d if code in KEY_RIGHT else 0)
            dy = -d if code in KEY_UP else (d if code in KEY_DOWN else 0)
            p = store[name][active]
            store[name][active] = [float(np.clip(p[0] + dx, 0, w - 1)), float(np.clip(p[1] + dy, 0, h - 1))]
            on_point["v"] = True
            continue

        k = key_of(code)
        if k == ord("1"):
            active = "base"
        elif k == ord("2"):
            active = "dir"
        elif k == ord("g"):
            step_idx = (step_idx + 1) % len(NUDGE_STEPS)
        elif k == ord("f"):
            e = store.get(name, {})
            if len(e) == 2:
                # Reverse, do not swap: the base is a real landmark on the handle; the
                # direction point only says which way the handle runs.
                b, d = np.array(e["base"], float), np.array(e["dir"], float)
                e["dir"] = (b - (d - b)).tolist()
        elif k == ord("n"):
            idx = (idx + 1) % len(cutouts)
        elif k == ord("b"):
            idx = (idx - 1) % len(cutouts)
        elif k == ord("m"):
            corner = (corner + 1) % 4
        elif k == ord("h"):
            show_loupe = not show_loupe
        elif k in (ord("+"), ord("=")):
            zoom = min(14, zoom + 1)
        elif k in (ord("-"), ord("_")):
            zoom = max(2, zoom - 1)
        elif k == ord("s"):
            missing = [n for n, _ in cutouts if len(store.get(n, {})) != 2]
            if missing:
                print(f"still missing both points on: {missing}")
                continue
            save_json(paths.meta / "template_points.json", store)
            print(f"\nsaved {paths.meta / 'template_points.json'}")
            for n, _ in cutouts:
                e = store[n]
                a = angle_deg(np.array([e["base"], e["dir"]]))
                print(f"  {n}: base={e['base']} dir={e['dir']} angle={a:.1f}deg")
            break
        elif k == ord("q"):
            print("not saved")
            break

    cv2.destroyAllWindows()
    print(f"Next: python 00_seed_keypoints.py --object {args.object}")


if __name__ == "__main__":
    main()
