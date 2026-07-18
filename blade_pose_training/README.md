# Blade-pose training pipeline

This is the training code used to produce the `resources/models/blade{1,2,3}.onnx`
keypoint-detection weights shipped with NARIMAN. It's published here — code
only, no training data or intermediate checkpoints — as the Corresponding
Source for that model under [Ultralytics YOLO11's AGPL-3.0
license](https://github.com/ultralytics/ultralytics/blob/main/LICENSE), which
NARIMAN's own AGPL-3.0 license satisfies for the combined work.

**What's here:** the full numbered pipeline (`00_seed_keypoints.py` through
`12_decode_onnx.py`), the `bladekit/` support package, and the shell-script
wrappers used to run each stage. The scripts expect a virtualenv at
`.venv/` in this directory (`PY=.venv/bin/python` at the top of each) —
adjust that to your own environment.

**What's deliberately not here:** the training videos/images and derived
crops (several GB of fixed-camera footage of a laryngoscope-and-mannequin
rig, not clinical footage of a patient), the intermediate `.pt` checkpoints,
and the exported `.onnx` weights (those live at
[`resources/models/`](../resources/models/) in the repo root). None of that
is required to satisfy AGPL-3.0's source-availability obligation, which
covers code, not training data — see [`HANDOFF.md`](HANDOFF.md) for how the
pieces fit together if you're rebuilding from scratch with your own footage.

Base pretrained checkpoints (`yolo11n-pose.pt`, `yolo11s-pose.pt`) are
Ultralytics' own public downloads — get them from
[Ultralytics' releases](https://github.com/ultralytics/assets/releases)
rather than from this repo.

Licensed under AGPL-3.0, same as the rest of this repository — see the root
[`LICENSE`](../LICENSE).
