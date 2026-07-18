"""Polygon editor with point selection, arrow-key nudging, and a magnifier.

At 36 px a blade's outline is ~10 pixels wide. Clicking it accurately with a mouse is not
possible; the label noise you introduce is the same size as the mask error you are trying
to measure. So: click coarsely, then select a point and nudge it with the arrow keys while
the loupe tracks it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

# cv2.waitKeyEx returns platform-specific codes for arrows: macOS, GTK, Windows.
# The 81-84 codes some examples use are the `waitKey() & 0xFF` convention, not waitKeyEx's.
# Including them here would swallow Q, R, S and T -- so a capital S would pan instead of save.
KEY_LEFT = {63234, 65361, 2424832}
KEY_UP = {63232, 65362, 2490368}
KEY_RIGHT = {63235, 65363, 2555904}
KEY_DOWN = {63233, 65364, 2621440}
KEY_TAB = {9}
KEY_DELETE = {8, 127, 65535, 3014656}
KEY_ENTER = {13, 10}

SELECT_RADIUS = 7.0
NUDGE_STEPS = (1, 2, 5, 10)

COL_POINT = (0, 255, 255)
COL_FIRST = (255, 0, 0)
COL_SEL = (0, 128, 255)
COL_EDGE = (0, 255, 255)
COL_CLOSE = (0, 180, 255)
COL_HELP = (0, 255, 0)


def key_of(code: int) -> int:
    """Low byte of a waitKeyEx code, for plain-character comparisons."""
    return code & 0xFF


@dataclass
class PolygonEditor:
    """Holds one polygon in *image* coordinates and mutates it from user input."""

    points: list[list[float]] = field(default_factory=list)
    selected: int | None = None
    closed: bool = False
    step_idx: int = 0

    @property
    def step(self) -> int:
        return NUDGE_STEPS[self.step_idx]

    def cycle_step(self) -> None:
        self.step_idx = (self.step_idx + 1) % len(NUDGE_STEPS)

    def load(self, pts: np.ndarray | None) -> None:
        self.points = [] if pts is None else [[float(x), float(y)] for x, y in pts]
        self.selected = None
        self.closed = len(self.points) >= 3

    def as_array(self) -> np.ndarray | None:
        if len(self.points) < 3:
            return None
        return np.array(self.points, np.float32)

    def hit(self, x: float, y: float, radius: float = SELECT_RADIUS) -> int | None:
        best, best_d = None, radius
        for i, (px, py) in enumerate(self.points):
            d = float(np.hypot(px - x, py - y))
            if d <= best_d:
                best, best_d = i, d
        return best

    def add(self, x: float, y: float) -> None:
        """Append a point. No proximity check: tracing a 36 px blade needs vertices only a
        couple of pixels apart, and a select-on-near-click would swallow most of them."""
        if self.closed:
            return
        self.points.append([float(x), float(y)])
        self.selected = len(self.points) - 1

    def select_at(self, x: float, y: float) -> bool:
        i = self.hit(x, y)
        if i is not None:
            self.selected = i
        return i is not None

    def on_left(self, x: float, y: float) -> bool:
        """Open polygon: add a vertex. Closed polygon: grab the nearest one.

        Returns True if a point was grabbed (the caller may start a drag).
        """
        if self.closed:
            return self.select_at(x, y)
        self.add(x, y)
        return False

    def move_selected(self, x: float, y: float, w: int, h: int) -> None:
        if self.selected is None:
            return
        self.points[self.selected] = [float(np.clip(x, 0, w - 1)), float(np.clip(y, 0, h - 1))]

    def nudge(self, dx: int, dy: int, w: int, h: int) -> None:
        if self.selected is None or not self.points:
            return
        p = self.points[self.selected]
        p[0] = float(np.clip(p[0] + dx * self.step, 0, w - 1))
        p[1] = float(np.clip(p[1] + dy * self.step, 0, h - 1))

    def select_next(self, delta: int = 1) -> None:
        if not self.points:
            return
        self.selected = 0 if self.selected is None else (self.selected + delta) % len(self.points)

    def insert_after_selected(self) -> None:
        """Add a vertex at the midpoint of the edge leaving the selected point."""
        if self.selected is None or len(self.points) < 2:
            return
        i = self.selected
        j = (i + 1) % len(self.points)
        mid = [(self.points[i][0] + self.points[j][0]) / 2, (self.points[i][1] + self.points[j][1]) / 2]
        self.points.insert(i + 1, mid)
        self.selected = i + 1

    def delete_selected(self) -> None:
        if self.selected is None or not self.points:
            return
        self.points.pop(self.selected)
        if not self.points:
            self.selected, self.closed = None, False
        else:
            self.selected = min(self.selected, len(self.points) - 1)
            self.closed = self.closed and len(self.points) >= 3

    def undo(self) -> None:
        if self.points:
            self.points.pop()
            self.selected = len(self.points) - 1 if self.points else None
            self.closed = self.closed and len(self.points) >= 3

    def reset(self) -> None:
        self.points.clear()
        self.selected = None
        self.closed = False

    def close(self) -> bool:
        if len(self.points) >= 3:
            self.closed = True
            return True
        return False

    def handle_key(self, code: int, w: int, h: int) -> bool:
        """Apply an editing key. Returns True if the key was consumed."""
        if code in KEY_LEFT:
            self.nudge(-1, 0, w, h)
        elif code in KEY_RIGHT:
            self.nudge(1, 0, w, h)
        elif code in KEY_UP:
            self.nudge(0, -1, w, h)
        elif code in KEY_DOWN:
            self.nudge(0, 1, w, h)
        elif code in KEY_TAB:
            self.select_next()
        elif code in KEY_DELETE:
            self.delete_selected()
        else:
            k = key_of(code)
            if k == ord("u"):
                self.undo()
            elif k == ord("r"):
                self.reset()
            elif k == ord("c"):
                self.close()
            elif k == ord("e"):
                self.insert_after_selected()
            elif k == ord("g"):
                self.cycle_step()
            else:
                return False
        return True


def draw_polygon(view: np.ndarray, ed: PolygonEditor, scale: float) -> None:
    pts = ed.points
    for i in range(1, len(pts)):
        a = (int(pts[i - 1][0] * scale), int(pts[i - 1][1] * scale))
        b = (int(pts[i][0] * scale), int(pts[i][1] * scale))
        cv2.line(view, a, b, COL_EDGE, 1, cv2.LINE_AA)
    if len(pts) > 2:
        a = (int(pts[0][0] * scale), int(pts[0][1] * scale))
        b = (int(pts[-1][0] * scale), int(pts[-1][1] * scale))
        cv2.line(view, b, a, COL_CLOSE, 2 if ed.closed else 1, cv2.LINE_AA)
    for i, (px, py) in enumerate(pts):
        c = (int(px * scale), int(py * scale))
        if i == ed.selected:
            cv2.circle(view, c, 6, COL_SEL, -1)
            cv2.circle(view, c, 9, COL_SEL, 1)
        elif i == 0:
            cv2.circle(view, c, 5, COL_FIRST, -1)
        else:
            cv2.circle(view, c, 3, COL_POINT, -1)


CORNERS = ("bottom-right", "bottom-left", "top-left", "top-right")


def corner_anchor(view: np.ndarray, box: int, corner: int, pad: int = 10) -> tuple[int, int]:
    vh, vw = view.shape[:2]
    right, bottom = max(0, vw - box - pad), max(0, vh - box - pad)
    return {
        0: (right, bottom),
        1: (pad, bottom),
        2: (pad, pad),
        3: (right, pad),
    }[corner % 4]


def draw_magnifier(
    view: np.ndarray,
    img: np.ndarray,
    center: tuple[float, float],
    ed: PolygonEditor,
    zoom: int,
    box: int,
    anchor: tuple[int, int] | None = None,
    corner: int = 0,
) -> None:
    """Zoomed inset around `center` (image coords), with the polygon drawn inside it.

    Defaults to the bottom-right corner: the blade is usually up near the patient's head,
    and a top-right loupe covers exactly the region you are trying to trace.
    """
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

    def to_mag(p) -> tuple[int, int]:
        return int((p[0] - x1) * sx), int((p[1] - y1) * sy)

    pts = ed.points
    for i in range(1, len(pts)):
        cv2.line(mag, to_mag(pts[i - 1]), to_mag(pts[i]), COL_EDGE, 1, cv2.LINE_AA)
    if len(pts) > 2:
        cv2.line(mag, to_mag(pts[-1]), to_mag(pts[0]), COL_CLOSE, 1, cv2.LINE_AA)
    for i, p in enumerate(pts):
        if x1 <= p[0] <= x2 and y1 <= p[1] <= y2:
            c = to_mag(p)
            if i == ed.selected:
                cv2.circle(mag, c, 6, COL_SEL, -1)
            elif i == 0:
                cv2.circle(mag, c, 4, COL_FIRST, -1)
            else:
                cv2.circle(mag, c, 3, COL_POINT, -1)

    cx, cy = to_mag((ix, iy))
    cv2.line(mag, (cx, 0), (cx, box - 1), (0, 255, 255), 1)
    cv2.line(mag, (0, cy), (box - 1, cy), (0, 255, 255), 1)
    cv2.rectangle(mag, (0, 0), (box - 1, box - 1), COL_HELP, 2)
    cv2.putText(mag, f"{zoom}x", (8, box - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.55, COL_HELP, 2)

    vh, vw = view.shape[:2]
    mx, my = anchor if anchor else corner_anchor(view, box, corner)
    mx = int(np.clip(mx, 0, max(0, vw - box)))
    my = int(np.clip(my, 0, max(0, vh - box)))
    bh, bw = mag.shape[:2]
    view[my : my + bh, mx : mx + bw] = mag[: max(0, vh - my), : max(0, vw - mx)]


def draw_help(view: np.ndarray, lines: list[str]) -> None:
    y = 24
    for line in lines:
        cv2.putText(view, line, (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(view, line, (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, COL_HELP, 1, cv2.LINE_AA)
        y += 22
