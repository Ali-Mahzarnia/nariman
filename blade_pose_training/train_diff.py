"""Walk the actual TRAINING crops and show ground-truth label vs. model prediction overlaid,
two colors, so you can see exactly where and why they disagree -- even on data it trained on.

    PY=.venv/bin/python
    $PY train_diff.py --object objects/blade1 --weights objects/blade1/runs/train/clean/weights/last.pt

RED   = ground truth label (what you told it)
CYAN  = model prediction on this exact crop

Controls: n/space next, p previous, q/ESC quit. Sorted worst-angle-error-first by default,
so the most suspicious frames come up immediately.
"""
import argparse

import cv2
import numpy as np
from ultralytics import YOLO

from bladekit.core import resolve_object
from bladekit.kpts import angle_deg, angle_error_deg, read_pose_label

DISPLAY_LEN = 90.0
LOUPE_SRC = 45
LOUPE_OUT = 300


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--object", default="objects/blade1")
    ap.add_argument("--weights", required=True)
    ap.add_argument("--split", default="train", choices=["train", "val"])
    ap.add_argument("--conf", type=float, default=0.1)
    ap.add_argument("--sort", default="worst", choices=["worst", "name"])
    args = ap.parse_args()

    paths = resolve_object(args.object)
    model = YOLO(args.weights)
    images = sorted((paths.dataset / "images" / args.split).glob("pos_*.jpg"))
    labels_dir = paths.dataset / "labels" / args.split

    items = []
    for img_path in images:
        img = cv2.imread(str(img_path))
        h, w = img.shape[:2]
        gt = read_pose_label(labels_dir / f"{img_path.stem}.txt", w, h)
        if not gt:
            continue
        gt_kps = gt[0][0]
        r = model.predict(source=img, conf=args.conf, imgsz=640, device="cpu", verbose=False)[0]
        if r.boxes is None or len(r.boxes) == 0:
            items.append((img_path, gt_kps, None, 999.0))
            continue
        i = int(r.boxes.conf.argmax())
        pk = r.keypoints.data.cpu().numpy()[i][:, :2]
        err = angle_error_deg(angle_deg(pk), angle_deg(gt_kps))
        items.append((img_path, gt_kps, pk, err))

    if args.sort == "worst":
        items.sort(key=lambda x: -x[3])
    print(f"{len(items)} {args.split} crops, sorted {'worst-first' if args.sort=='worst' else 'by name'}")

    st = {"mouse": (0, 0)}

    def on_mouse(event, mx, my, flags, _):
        st["mouse"] = (mx, my)

    win = "train diff: RED=label  CYAN=prediction"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(win, on_mouse)

    def draw_pair(base, tip, color):
        d = tip - base
        n = float(np.hypot(*d))
        u = d / n if n > 1e-6 else np.array([1.0, 0.0], np.float32)
        disp = base + u * DISPLAY_LEN
        return base, disp, color

    i = 0
    while True:
        img_path, gt_kps, pk, err = items[i]
        img = cv2.imread(str(img_path))
        h, w = img.shape[:2]
        vis = img.copy()

        gb, gd, _ = draw_pair(gt_kps[0], gt_kps[1], (0, 0, 255))
        cv2.line(vis, tuple(gb.astype(int)), tuple(gd.astype(int)), (0, 0, 255), 1, cv2.LINE_8)
        vis[int(gb[1]), int(gb[0])] = (0, 0, 255)

        if pk is not None:
            pb, pd, _ = draw_pair(pk[0], pk[1], (255, 255, 0))
            cv2.line(vis, tuple(pb.astype(int)), tuple(pd.astype(int)), (255, 255, 0), 1, cv2.LINE_8)
            vis[int(pb[1]), int(pb[0])] = (255, 255, 0)
            base_dist = float(np.hypot(*(pk[0] - gt_kps[0])))
        else:
            base_dist = -1.0

        vis = cv2.resize(vis, (w * 3, h * 3), interpolation=cv2.INTER_NEAREST)
        w, h = w * 3, h * 3

        hud = f"{i+1}/{len(items)}  {img_path.stem}  angle_err={err:.1f}deg  base_dist={base_dist:.1f}px"
        cv2.rectangle(vis, (0, 0), (w, 22), (0, 0, 0), -1)
        cv2.putText(vis, hud, (6, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
        cv2.imshow(win, vis)

        k = cv2.waitKey(20) & 0xFF
        if k == 255:
            continue
        if k in (ord("q"), 27):
            break
        elif k in (ord("n"), ord(" ")):
            i = min(i + 1, len(items) - 1)
        elif k == ord("p"):
            i = max(i - 1, 0)

    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
