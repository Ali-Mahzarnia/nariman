"""Step 1 -- trace a sharp RGBA cutout of the blade from a template photo.

Trace tightly. Every synthetic instance is this cutout scaled down to ~36 px, so a sloppy
outline becomes a sloppy segmentation prior across the entire training set. Several cutouts
at different angles / lighting are strictly better than one; they are sampled uniformly.

Keys
  click            add a point, or select an existing one
  arrows           nudge the selected point (loupe follows it)
  g                cycle nudge step 1 -> 2 -> 5 -> 10 px
  Tab              select next point
  e                insert a point after the selected one
  Delete           delete the selected point
  u / r / c        undo last point / reset / close polygon
  s                save cutout and start a new one
  + / -            loupe zoom
  m / h            move the loupe to another corner / hide it
  q                quit
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

from bladekit.core import resolve_object
from bladekit.ui import (
    CORNERS,
    KEY_DOWN,
    KEY_LEFT,
    KEY_RIGHT,
    KEY_TAB,
    KEY_UP,
    PolygonEditor,
    draw_help,
    draw_magnifier,
    draw_polygon,
    key_of,
)

# Arrow/Tab means "I am working on the selected point"; the loupe tracks it. Moving the
# mouse hands the loupe back to the cursor.
POINT_FOCUS_KEYS = KEY_LEFT | KEY_RIGHT | KEY_UP | KEY_DOWN | KEY_TAB

HELP = [
    "L-click=add (open) / drag (closed)   R-click=select   arrows=nudge  g=step",
    "Tab=next  e=insert  Del=remove  u=undo  r=reset  c=close  s=save  +/-  m/h  q",
]


def save_cutout(image_path: Path, img: np.ndarray, pts: np.ndarray, idx: int, out: Path) -> None:
    h, w = img.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    cv2.fillPoly(mask, [pts.astype(np.int32)], 255)
    x, y, bw, bh = cv2.boundingRect(pts.astype(np.int32))
    pad = 8
    x1, y1 = max(0, x - pad), max(0, y - pad)
    x2, y2 = min(w, x + bw + pad), min(h, y + bh + pad)
    rgba = np.dstack([img[y1:y2, x1:x2], mask[y1:y2, x1:x2]])

    out.mkdir(parents=True, exist_ok=True)
    stem = f"{image_path.stem}_{idx:02d}"
    cv2.imwrite(str(out / f"{stem}.png"), rgba)
    print(f"saved {out / f'{stem}.png'}  ({x2 - x1}x{y2 - y1})")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image", type=Path, help="Template photo of the blade.")
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--max-width", type=int, default=1300)
    ap.add_argument("--zoom", type=int, default=7)
    ap.add_argument("--loupe", type=int, default=300)
    ap.add_argument("--loupe-corner", type=int, default=0, choices=[0, 1, 2, 3],
                    help="0=bottom-right 1=bottom-left 2=top-left 3=top-right")
    args = ap.parse_args()

    paths = resolve_object(args.object)
    image_path = args.image if args.image.is_absolute() else paths.templates / args.image.name
    img = cv2.imread(str(image_path))
    if img is None:
        raise SystemExit(f"Could not read image: {image_path}")

    h, w = img.shape[:2]
    scale = min(1.0, args.max_width / w)
    ed = PolygonEditor()
    mouse = {"x": 0.0, "y": 0.0}
    focus_mode = {"on_point": False}
    zoom = args.zoom
    corner = args.loupe_corner
    show_loupe = True
    save_idx = len(list(paths.cutouts.glob(f"{image_path.stem}_*.png")))
    win = f"01 cut template - {image_path.name}"

    dragging = {"on": False}

    def on_mouse(event, x, y, _flags, _param):
        ix, iy = x / scale, y / scale
        mouse["x"], mouse["y"] = ix, iy
        if event == cv2.EVENT_MOUSEMOVE:
            focus_mode["on_point"] = False
            if dragging["on"]:
                ed.move_selected(ix, iy, w, h)
        elif event == cv2.EVENT_LBUTTONDOWN:
            dragging["on"] = ed.on_left(ix, iy)
            focus_mode["on_point"] = False
        elif event == cv2.EVENT_LBUTTONUP:
            dragging["on"] = False
        elif event == cv2.EVENT_RBUTTONDOWN:
            ed.select_at(ix, iy)
            focus_mode["on_point"] = False

    cv2.namedWindow(win)
    cv2.setMouseCallback(win, on_mouse)

    while True:
        view = cv2.resize(img, (int(w * scale), int(h * scale))) if scale != 1.0 else img.copy()
        draw_polygon(view, ed, scale)
        draw_help(view, HELP + [
            f"points={len(ed.points)} step={ed.step}px cutouts={save_idx}"
            f"   loupe={CORNERS[corner % 4] if show_loupe else 'hidden'} (m/h)",
        ])
        if show_loupe:
            track_point = focus_mode["on_point"] and ed.selected is not None
            focus = ed.points[ed.selected] if track_point else (mouse["x"], mouse["y"])
            draw_magnifier(view, img, focus, ed, zoom, args.loupe, corner=corner)
        cv2.imshow(win, view)

        code = cv2.waitKeyEx(20)
        if code == -1:
            continue
        if ed.handle_key(code, w, h):
            if code in POINT_FOCUS_KEYS:
                focus_mode["on_point"] = True
            continue
        k = key_of(code)
        if k == ord("s"):
            pts = ed.as_array()
            if pts is None:
                print("need at least 3 points")
                continue
            save_cutout(image_path, img, pts, save_idx, paths.cutouts)
            save_idx += 1
            ed.reset()
        elif k in (ord("+"), ord("=")):
            zoom = min(14, zoom + 1)
        elif k in (ord("-"), ord("_")):
            zoom = max(2, zoom - 1)
        elif k == ord("m"):
            corner = (corner + 1) % 4
        elif k == ord("h"):
            show_loupe = not show_loupe
        elif k == ord("q"):
            break

    cv2.destroyAllWindows()
    n = len(list(paths.cutouts.glob("*.png")))
    print(f"\n{n} cutout(s) in {paths.cutouts}")
    print(f"Next: python 02_browse_label.py --object {args.object} --video <clip.mp4>")


if __name__ == "__main__":
    main()
