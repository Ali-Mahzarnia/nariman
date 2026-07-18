# Third-Party Components

NARIMAN is licensed under AGPL-3.0 (see [LICENSE](LICENSE)). It builds on the
open-source components below for on-device inference and media handling.
This file is the authoritative attribution record; nothing here is
marketing copy.

---

## Ultralytics YOLO11 — AGPL-3.0

Copyright (c) Ultralytics Inc. <https://github.com/ultralytics/ultralytics>

Used at model-development time to train the keypoint-detection model that
locates the laryngoscope blade in the primary camera view. No Ultralytics
code ships in the packaged app — only the exported ONNX weights
(`resources/models/blade{1,2,3}.onnx`, tracked in this repo) run on-device
through `onnxruntime-node`. NARIMAN is distributed under AGPL-3.0 itself,
which satisfies YOLO11's AGPL-3.0 license for that use, and the training
pipeline that produced those weights — code only, no training data — is
published at [`blade_pose_training/`](blade_pose_training/) as the
Corresponding Source. (The training videos, cropped-image datasets, and
intermediate `.pt` checkpoints stay local to the maintainer's machine —
AGPL-3.0's source-availability obligation covers code, not training data.)

License: <https://github.com/ultralytics/ultralytics/blob/main/LICENSE>

---

## MediaPipe Tasks-Vision — Apache License 2.0

Copyright Google LLC

Used for on-device human pose landmark detection (`@mediapipe/tasks-vision`
npm package, plus the `pose_landmarker_full.task` model asset bundled in
`assets/`). Drives the automatic hip-angle tracking and the eye tracker's
face landmarks.

```
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

## whisper.cpp — MIT License

Copyright (c) 2023-2024 Georgi Gerganov

Used as a bundled binary (`whisper`/`whisper.exe`) for fully offline,
on-device speech-to-text transcription. The binary and its GGML model are
fetched separately and placed under `resources/bin/` and `resources/models/`
at build time; they are not committed to this repository (see
`.gitignore` and the "Building from source" section of the README).

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

---

## ONNX Runtime (`onnxruntime-node`) — MIT License

Copyright (c) Microsoft Corporation

Runs the exported blade-pose ONNX models on-device (CPU) to drive the
automatic Blade Tracker.

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

---

## mp4box.js — BSD-3-Clause License

Copyright (c) Telecom ParisTech/TSI/MM/GPAC

Used to read container metadata (frame rate detection) from loaded videos.

```
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

---

## xlsx (SheetJS Community Edition) — Apache License 2.0

Copyright (c) SheetJS LLC

Used to build and append rows to the exported Excel workbook.

License: <https://www.apache.org/licenses/LICENSE-2.0>

---

## Electron — MIT License

Copyright (c) Electron contributors, GitHub Inc., OpenJS Foundation

Application shell and packaging framework.

License: <https://github.com/electron/electron/blob/main/LICENSE>

---

## FFmpeg — LGPL / GPL (build-dependent)

Copyright the FFmpeg contributors

Bundled as an unmodified, pre-built external binary (`ffmpeg`/`ffmpeg.exe`)
and invoked as a separate subprocess to extract audio for transcription. It
is not linked into or compiled as part of this application, its source is
not modified, and the binary itself is not committed to this repository (it
is fetched separately at build time, like the whisper.cpp binary above).

License details for the specific build in use: <https://ffmpeg.org/legal.html>

---

## A note on voice-activity detection

Speech-region detection ("VAD") ahead of transcription is a small,
energy-based detector implemented directly in this project's own source
(`main.js`). It is original code, not a third-party dependency, so no
external license applies to it.
