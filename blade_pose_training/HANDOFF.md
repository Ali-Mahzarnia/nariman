# Blade pose models — integration notes

Three trained YOLO11n-pose models that find a laryngoscope blade in fixed-camera clinical
video and report **where the handle's base is** and **which way the handle points**. One
blade of a known type is in frame at a time; the app loads the matching model.

## What to grab (all under this directory)

Per blade `N` in {1, 2, 3}:

    objects/bladeN/runs/train/blade/weights/last.onnx   <- ship this
    objects/bladeN/meta/export.json                     <- how to preprocess + decode
    objects/bladeN/meta/predict_config.json             <- crop size, calibrated conf (see note)

Reference decoder (Python, ~120 lines, PROVEN to match the training framework to 0.00 px):

    12_decode_onnx.py           <- port this to your app runtime
    08_predict.py               <- full reference: ROI, decode, smoothing, outlier gate

The `.pt` files sit next to the `.onnx` if you ever need to re-export or re-validate.

## The model contract (identical for all three)

- Input: one image tensor `1 x 3 x 640 x 640`, RGB, float32, divided by 255, NCHW.
  Feed EXACTLY 640x640 — the 8400 anchor count is baked in; any other size breaks decode.
- Output: one tensor `1 x 11 x 8400`. Transpose to `(8400, 11)`. Each row is

      [cx, cy, w, h,  conf,  kx0, ky0, kv0,  kx1, ky1, kv1]

  all in **640-space, absolute pixels** (not normalized). One class, so `conf` is the
  detection confidence directly. `kv*` are keypoint visibility logits — you can ignore them.
- keypoint 0 = **base** (butt of the handle). keypoint 1 = **dir** (a virtual point 24 px up
  the handle axis; NOT an anatomical landmark, only encodes direction).

## How to run one frame (the 6 steps, verified in 12_decode_onnx.py)

1. Take the user's ROI on the frame. Cut a **320 x 320** window centered on the ROI center
   (clamp to frame edges). This is `crop`; from export.json, always 320.
2. Resize that 320 crop to 640x640, BGR->RGB, /255, to `1x3x640x640` float32.
3. Run the ONNX -> `(1, 11, 8400)`.
4. Transpose to `(8400, 11)`; keep rows with `conf >= THRESHOLD`; take the single highest-conf
   row (exactly one blade is in frame).
5. Map that row's keypoints from 640-space back: multiply by `320/640 = 0.5` (crop-space),
   then add the crop's top-left `(x, y)` -> full-frame pixels.
6. `base = kp0`. `angle_degrees = atan2(kp1.y - kp0.y, kp1.x - kp0.x)`.

## Interpreting the angle

- Measured base -> dir, standard image axes: **x right, y DOWN**. So +90 deg points DOWN the
  screen, -90 deg points UP, 180/-180 points LEFT, 0 points RIGHT.
- In this footage the handle points roughly left, so angle sits near ±180. That means a small
  wobble reads as +179 one frame and -179 the next: those are 2 deg apart, NOT 358. When you
  compare or average angles, do it on the **unit vector** (cos, sin), never the raw degrees,
  or the ±180 wrap will flip the handle backwards.
- Accuracy on held-out video: base within ~1.2-1.6 px, angle within ~2.5-3.5 deg median.

## THRESHOLD — do not use the calibrated conf blindly

export.json / predict_config.json carry a `conf` that maximized F1 on a clean validation set.
It can be brittle-high: blade3 calibrated to 0.91 and then dropped the blade whenever a
reflection strip crossed the handle. **Use ~0.25-0.40 in the app.** False-positive rate is
~0 there, so lowering it is free. The threshold lives in YOUR code, not the ONNX.

Per-blade calibrated values (for reference only): blade1 0.62, blade2 0.54, blade3 0.25.

## ROI is a hard boundary

The model needs a >=320 px window, so if the user's ROI is smaller it gets padded up and a
detection could technically land in that margin. The rule to implement: **accept a detection
only if its BASE keypoint (kp0, full-frame) is inside the user's drawn ROI rectangle.**
Otherwise report no detection this frame. (08_predict.py does this with --roi-strict.)

## Temporal smoothing (optional but recommended — see Smoother in 08_predict.py)

Each frame is independent, so a still blade jitters ~1.7 deg frame to frame. Two tools:
- **Outlier gate:** reject a detection whose base jumped > 40 px or whose direction turned
  > 45 deg since the last accepted frame — a held blade cannot teleport or spin that fast.
- **Adaptive EMA:** blend base and the direction UNIT VECTOR toward the new reading with
  alpha that grows with motion (smooth when still, no lag when moving). alpha 0.3 baseline.
This took the on-video angle jitter from ~1.7 deg to ~0.4 deg without lagging real motion.

## Sanity-check the port

Run `12_decode_onnx.py --object objects/bladeN` in this directory (venv:
`.venv/bin/python`). It prints the numpy decode next
to the training-framework result and must say MATCH (0.00 px). Your app's decode should
reproduce the same base/angle on the same crop.
