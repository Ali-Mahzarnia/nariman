// Blade-pose tracker — ports the proven reference pipeline for the three trained
// keypoint-pose blade models. One blade of a known type is in frame at a time;
// the ACTIVE blade slot (state.activeTemplate ∈ {1,2,3}) selects the matching
// ONNX model.
//
// Split across processes so the UI thread stays responsive:
//   • renderer (this file, browser side): geometry only — compute crop windows
//     the way the model trained (single 320 window for a small ROI, tiled 320
//     windows for a larger one), extract each window's raw pixels from the video
//     with a canvas, then map results back to the full frame and gate on the ROI.
//   • main process: the heavy work — resize each raw crop to 640 (cv2.INTER_LINEAR
//     -matched bilinear + uint8), run onnxruntime-node (CPU), decode (1,11,8400).
//
// The pure functions (decode + resize) are shared: main.js require()s this file.
//
// Model contract: input 1×3×640×640 float32 RGB /255 NCHW; output 1×11×8400,
// column i = [cx,cy,w,h,conf, kx0,ky0,kv0, kx1,ky1,kv1] in 640-space pixels.
// kp0 = handle base, kp1 = 24px up the handle (direction). Output is laid out
// (11,8400) row-major, so channel c, anchor i is out[c*8400 + i].
(function (root) {
  const IMGSZ = 640;      // network input — baked into the 8400 anchor count
  const CROP = 320;       // window size the model trained on (from export.json)
  const TRAIN_W = 960;    // frame width the models were trained on (960×722)
  const NUM_ANCHORS = 8400;
  const CONF = 0.30;      // app threshold — NOT the brittle-high calibrated conf
  const TILE_OVERLAP = 0.25;

  // The models expect the blade at the pixel scale it trained on: a 320px crop of
  // a 960-wide frame (blade ≈ 72px once upscaled to 640). If the video is a
  // different resolution but the same framing, the blade's pixel size scales with
  // the width, so the crop must scale too — otherwise the model sees the blade at
  // a size it never trained on and misses or mislocates it. On a 960-wide video
  // this is exactly 320 (no change); it only adapts other resolutions.
  function cropFor(dims) {
    const s = Math.round(CROP * dims.w / TRAIN_W);
    return Math.max(96, Math.min(s, dims.w, dims.h));
  }

  // ── Pure: decode a raw (1,11,8400) output → best detection in 640-space ─────
  function decodeBest(out, confThresh) {
    const thr = (confThresh == null) ? CONF : confThresh;
    const N = NUM_ANCHORS;
    let bestI = -1, bestC = thr;
    for (let i = 0; i < N; i++) {
      const c = out[4 * N + i];
      if (c >= bestC) { bestC = c; bestI = i; }
    }
    if (bestI < 0) return null;
    return {
      conf: bestC,
      base: [out[5 * N + bestI], out[6 * N + bestI]],   // kp0 (kx0, ky0)
      dir:  [out[8 * N + bestI], out[9 * N + bestI]],   // kp1 (kx1, ky1)
    };
  }

  // ── Pure: raw RGBA crop (size×size uint8) → 1×3×640×640 float32 tensor ──────
  // cv2.resize outputs a uint8 image (INTER_LINEAR, half-pixel centers), then
  // /255. The models are LSB-sensitive over the 24px base→dir baseline, so match
  // that: bilinear in float, round to the 0..255 grid, divide.
  function rgbaCropToTensor(rgba, size) {
    const plane = IMGSZ * IMGSZ;
    const t = new Float32Array(3 * plane);
    const scale = size / IMGSZ;       // src/dst (0.5 for 320→640)
    const maxIdx = size - 1;
    for (let dy = 0; dy < IMGSZ; dy++) {
      let fy = (dy + 0.5) * scale - 0.5; if (fy < 0) fy = 0;
      let y0 = fy | 0; if (y0 > maxIdx) y0 = maxIdx;
      let y1 = y0 + 1; if (y1 > maxIdx) y1 = maxIdx;
      const wy = fy - y0;
      for (let dx = 0; dx < IMGSZ; dx++) {
        let fx = (dx + 0.5) * scale - 0.5; if (fx < 0) fx = 0;
        let x0 = fx | 0; if (x0 > maxIdx) x0 = maxIdx;
        let x1 = x0 + 1; if (x1 > maxIdx) x1 = maxIdx;
        const wx = fx - x0;
        const w00 = (1 - wx) * (1 - wy), w10 = wx * (1 - wy);
        const w01 = (1 - wx) * wy,       w11 = wx * wy;
        const i00 = (y0 * size + x0) * 4, i10 = (y0 * size + x1) * 4;
        const i01 = (y1 * size + x0) * 4, i11 = (y1 * size + x1) * 4;
        const d = dy * IMGSZ + dx;
        t[d]             = Math.round(rgba[i00]     * w00 + rgba[i10]     * w10 + rgba[i01]     * w01 + rgba[i11]     * w11) / 255;
        t[d + plane]     = Math.round(rgba[i00 + 1] * w00 + rgba[i10 + 1] * w10 + rgba[i01 + 1] * w01 + rgba[i11 + 1] * w11) / 255;
        t[d + 2 * plane] = Math.round(rgba[i00 + 2] * w00 + rgba[i10 + 2] * w10 + rgba[i01 + 2] * w01 + rgba[i11 + 2] * w11) / 255;
      }
    }
    return t;
  }

  // Decode straight from a raw output into CROP-space keypoints (0..size). This
  // is what main.js returns to the renderer per window.
  function decodeToCrop(out, size, confThresh) {
    const det = decodeBest(out, confThresh);
    if (!det) return null;
    const s = size / IMGSZ;   // 640-space → crop-space
    return { conf: det.conf, base: [det.base[0] * s, det.base[1] * s], dir: [det.dir[0] * s, det.dir[1] * s] };
  }

  function angleRad(base, dir) { return Math.atan2(dir[1] - base[1], dir[0] - base[0]); }
  const angleDeg = (base, dir) => angleRad(base, dir) * 180 / Math.PI;

  // ── Temporal smoother (ported from 08_predict.py Smoother) ─────────────────
  // Outlier gate + adaptive EMA on the base point and the handle direction UNIT
  // VECTOR (never the raw angle — averaging +179° and -179° would flip the
  // handle). Smooths sub-pixel jitter when the blade is still; the alpha grows
  // with motion so a moving blade doesn't lag. A held blade can't teleport or
  // spin, so a base jump > maxJumpPx or a turn > maxTurnDeg is rejected as not
  // the blade; after `resetAfter` consecutive misses it re-acquires.
  class BladeSmoother {
    // Thresholds are looser than the reference (40px/45°/5) because playback
    // processes SPARSE frames (best-effort skips), so real motion between
    // processed frames is larger; too-tight gating would freeze the L. Faster
    // re-acquire (3) also avoids long freezes after a genuine fast move.
    constructor(alpha = 0.3, maxJumpPx = 70, maxTurnDeg = 60, resetAfter = 3,
                motionRefPx = 14, motionRefDeg = 14) {
      this.alpha = alpha; this.maxJumpPx = maxJumpPx; this.maxTurnDeg = maxTurnDeg;
      this.resetAfter = resetAfter; this.motionRefPx = motionRefPx; this.motionRefDeg = motionRefDeg;
      this.reset();
    }
    reset() { this.base = null; this.dir = null; this.missed = 0; }
    miss() { this.missed++; }
    _reacquiring() { return this.base === null || this.missed >= this.resetAfter; }
    // base: [x,y] px; dirUnit: unit [ux,uy]. Returns { base:[x,y], dir:[ux,uy] }
    // smoothed, or null if rejected as an outlier (caller keeps the previous L).
    update(base, dirUnit) {
      const u = dirUnit.slice();
      if (this._reacquiring()) {
        this.base = base.slice(); this.dir = u; this.missed = 0;
        return { base: this.base.slice(), dir: this.dir.slice() };
      }
      const jump = Math.hypot(base[0] - this.base[0], base[1] - this.base[1]);
      const cross = this.dir[0] * u[1] - this.dir[1] * u[0];
      const dot = this.dir[0] * u[0] + this.dir[1] * u[1];
      const turn = Math.abs(Math.atan2(cross, dot)) * 180 / Math.PI;
      if (jump > this.maxJumpPx || turn > this.maxTurnDeg) { this.missed++; return null; }
      const speed = Math.max(jump / this.motionRefPx, turn / this.motionRefDeg);
      const a = this.alpha + (1 - this.alpha) * Math.min(1, speed);
      this.base = [(1 - a) * this.base[0] + a * base[0], (1 - a) * this.base[1] + a * base[1]];
      let dx = (1 - a) * this.dir[0] + a * u[0], dy = (1 - a) * this.dir[1] + a * u[1];
      const m = Math.hypot(dx, dy); if (m > 1e-6) { dx /= m; dy /= m; }
      this.dir = [dx, dy]; this.missed = 0;
      return { base: this.base.slice(), dir: this.dir.slice() };
    }
  }

  // ── Browser-only: window geometry (mirrors bladekit roi_to_window/tile_windows)
  function computeWindows(roi, dims) {
    const W = dims.w, H = dims.h;
    const size = cropFor(dims);
    const rx = Math.round(roi.x * W), ry = Math.round(roi.y * H);
    const rw = Math.round(roi.w * W), rh = Math.round(roi.h * H);
    const clampWin = (cx, cy) => {
      let x = Math.round(cx - size / 2), y = Math.round(cy - size / 2);
      x = Math.max(0, Math.min(x, W - size));
      y = Math.max(0, Math.min(y, H - size));
      return { x, y, size };
    };
    // ROI fits in one window → single crop centered on the ROI center.
    if (rw <= size && rh <= size) return [clampWin(rx + rw / 2, ry + rh / 2)];
    // Larger ROI → tile overlapping windows so the blade is seen at training scale.
    const step = Math.max(1, Math.floor(size * (1 - TILE_OVERLAP)));
    let xs = []; for (let x = rx; x < Math.max(rx + 1, rx + rw - size + 1); x += step) xs.push(x); if (!xs.length) xs = [rx];
    let ys = []; for (let y = ry; y < Math.max(ry + 1, ry + rh - size + 1); y += step) ys.push(y); if (!ys.length) ys = [ry];
    if (xs[xs.length - 1] + size < rx + rw) xs.push(rx + rw - size);
    if (ys[ys.length - 1] + size < ry + rh) ys.push(ry + rh - size);
    const seen = new Set(), out = [];
    for (const wy of ys) for (const wx of xs) {
      const win = clampWin(wx + size / 2, wy + size / 2);
      const key = win.x + ',' + win.y;
      if (!seen.has(key)) { seen.add(key); out.push(win); }
    }
    return out;
  }

  // Browser-only: copy a window's pixels 1:1 (no resampling) into a Uint8 RGBA
  // buffer to hand to the main process.
  let _c = null, _cx = null;
  function extractCropRGBA(srcEl, win) {
    if (!_c) { _c = document.createElement('canvas'); _cx = _c.getContext('2d', { willReadFrequently: true }); }
    if (_c.width !== win.size || _c.height !== win.size) { _c.width = win.size; _c.height = win.size; }
    _cx.imageSmoothingEnabled = false;
    _cx.drawImage(srcEl, win.x, win.y, win.size, win.size, 0, 0, win.size, win.size);
    return _cx.getImageData(0, 0, win.size, win.size).data; // Uint8ClampedArray, size²×4
  }

  // Center a size×size window on (cx,cy) full-frame px, clamped to the frame.
  function centerWindow(cx, cy, size, W, H) {
    let x = Math.round(cx - size / 2), y = Math.round(cy - size / 2);
    x = Math.max(0, Math.min(x, W - size));
    y = Math.max(0, Math.min(y, H - size));
    return { x, y, size };
  }

  // Run one window → best detection in full-frame px { conf, baseF, dirF } | null.
  async function inferWindow(srcEl, win, blade, confThresh) {
    const rgba = extractCropRGBA(srcEl, win);
    let res = null;
    try { res = await root.api.bladeInfer(blade, rgba, win.size, confThresh); } catch (e) { return null; }
    if (!res) return null;
    return { conf: res.conf, baseF: [res.base[0] + win.x, res.base[1] + win.y], dirF: [res.dir[0] + win.x, res.dir[1] + win.y] };
  }

  // Full one-frame detection. Returns { base:{x,y}, dir:{x,y}, angle(rad), conf }
  // in NORMALIZED frame coords, or null (nothing found / base outside ROI).
  async function detect(srcEl, roi, dims, blade, confThresh, refine) {
    if (!srcEl || !roi || !dims) return null;
    const size = cropFor(dims);

    // Pass 1: locate the blade across the ROI's window(s).
    const wins = computeWindows(roi, dims);
    let best = null;
    for (const win of wins) {
      const r = await inferWindow(srcEl, win, blade, confThresh);
      if (r && (!best || r.conf > best.conf)) best = r;
    }
    if (!best) return null;

    // Pass 2 (refine): re-run a single window CENTERED on the blade center (the
    // midpoint of base and dir — how the model's training/eval crops were
    // centered). This puts the blade mid-frame at training scale, which is where
    // keypoint (and hence angle) accuracy is best. Skipped in fast mode (during
    // playback) to halve inference cost; the temporal smoother covers the extra
    // single-pass noise. Fall back to pass 1 if refine finds nothing.
    if (refine !== false) {
      const cx = (best.baseF[0] + best.dirF[0]) / 2, cy = (best.baseF[1] + best.dirF[1]) / 2;
      const rwin = centerWindow(cx, cy, size, dims.w, dims.h);
      const refined = await inferWindow(srcEl, rwin, blade, confThresh);
      if (refined) best = refined;
    }

    // ROI is a hard boundary: keep only if the BASE keypoint is inside it.
    const rx = roi.x * dims.w, ry = roi.y * dims.h, rw = roi.w * dims.w, rh = roi.h * dims.h;
    if (best.baseF[0] < rx || best.baseF[0] > rx + rw || best.baseF[1] < ry || best.baseF[1] > ry + rh) return null;
    return {
      base:  { x: best.baseF[0] / dims.w, y: best.baseF[1] / dims.h },
      dir:   { x: best.dirF[0]  / dims.w, y: best.dirF[1]  / dims.h },
      angle: angleRad(best.baseF, best.dirF),
      conf:  best.conf,
    };
  }

  // ── Angle refinement via line detection (ported from lsd_refine.py) ─────────
  // The nano model gives a coarse handle angle that wobbles under finger
  // occlusion. We refine it from the actual handle-wall edges near the base:
  // detect line segments in a 90×90 patch, keep those that agree with the coarse
  // angle and lie on the base→handle axis, and take their length-weighted mean.
  // OpenCV's LSD isn't in the browser, so segments come from a lightweight
  // detector (aligned-gradient region grow + PCA) — the Hough-family substitute
  // the handoff allows. Geometry/consensus/mean logic mirror the reference.
  const REFINE = {
    PATCH_R: 45,          // half-side of the search patch, full-frame px
    ANGLE_TOL_DEG: 15,    // keep segments within this of the coarse angle (mod 180)
    MIN_SEG_LEN: 3,       // discard shorter segments (sweet spot: short + heavy smoothing)
    MAX_PERP_DIST: 22,    // reject segments off the base→coarse axis
    CONSENSUS_DEG: 12,    // surviving segments must agree within this
    MAX_DRIFT_DEG: 25,    // refined angle may never drift more than this from the
                          // raw model angle (hard safety against a stuck smoother)
    MIN_REGION: 4,        // min pixels for a segment region
    GRAD_TOL_DEG: 22.5,   // region-grow: max level-line angle deviation
    MAG_THRESH: 20,       // Sobel gradient-magnitude threshold for edge pixels
                          // (tuned so refinements match OpenCV LSD to ~1.2° median)
    SILVER_MULT: 0.06,    // adaptive-threshold fraction of a patch's peak gradient
                          // (see detectSegments) — lower = more sensitive on
                          // low-contrast (silver) blades; never raises the
                          // threshold on high-contrast ones (always min'd w/ MAG_THRESH).
                          // Swept 0.16→0.04 against blade1's reference clip: blade1
                          // stayed at exactly 32/150 refined frames at EVERY value
                          // (its peak gradient is always well above threshold), so
                          // this is a verified-safe, more-sensitive push for silver.
    SILVER_FLOOR: 3,      // hard floor for the adaptive threshold (avoid pure noise)
  };
  const _mod180 = (d) => { d %= 180; return d < 0 ? d + 180 : d; };
  const _circDiff180 = (a, b) => { const d = Math.abs(_mod180(a) - _mod180(b)); return Math.min(d, 180 - d); };

  // Detect line segments in a grayscale patch. gray: Float32/Uint8 length w*h.
  // Returns [{ angle(deg, line direction), length, mx, my }].
  function detectSegments(gray, w, h) {
    const mag = new Float32Array(w * h);
    const lang = new Float32Array(w * h);   // level-line (line) angle, radians
    let peak = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1]) - (gray[i - w - 1] + 2 * gray[i - 1] + gray[i + w - 1]);
      const gy = (gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1]) - (gray[i - w - 1] + 2 * gray[i - w] + gray[i - w + 1]);
      const m = Math.hypot(gx, gy);
      mag[i] = m; if (m > peak) peak = m;
      lang[i] = Math.atan2(gy, gx) + Math.PI / 2;   // line direction ⟂ gradient
    }
    // Edge threshold: normally the tuned MAG_THRESH, but for a LOW-CONTRAST patch
    // (silver blade 3, whose peak gradient is weak) drop toward a fraction of the
    // patch's own peak so its fainter handle edges still register. For dark blades
    // (blade 1/2) peak·0.16 ≥ MAG_THRESH, so this is a no-op (verified identical).
    const magThr = Math.min(REFINE.MAG_THRESH, Math.max(REFINE.SILVER_FLOOR, peak * REFINE.SILVER_MULT));
    const used = new Uint8Array(w * h);
    const tol = REFINE.GRAD_TOL_DEG * Math.PI / 180;
    const segs = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const start = y * w + x;
      if (used[start] || mag[start] < magThr) continue;
      const stack = [start]; used[start] = 1; const region = [];
      let sumCos = 0, sumSin = 0;
      while (stack.length) {
        const p = stack.pop(); region.push(p);
        sumCos += Math.cos(2 * lang[p]); sumSin += Math.sin(2 * lang[p]);
        const meanAng = Math.atan2(sumSin, sumCos) / 2;
        const py = (p / w) | 0, px = p % w;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = px + dx, ny = py + dy;
          if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
          const np = ny * w + nx;
          if (used[np] || mag[np] < magThr) continue;
          let da = Math.abs(lang[np] - meanAng) % Math.PI; if (da > Math.PI / 2) da = Math.PI - da;
          if (da <= tol) { used[np] = 1; stack.push(np); }
        }
      }
      if (region.length < REFINE.MIN_REGION) continue;
      // PCA of the region's pixel coords → principal axis = line direction.
      let mx = 0, my = 0;
      for (const p of region) { mx += p % w; my += (p / w) | 0; }
      mx /= region.length; my /= region.length;
      let sxx = 0, syy = 0, sxy = 0;
      for (const p of region) { const dxp = (p % w) - mx, dyp = ((p / w) | 0) - my; sxx += dxp * dxp; syy += dyp * dyp; sxy += dxp * dyp; }
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const c = Math.cos(ang), s = Math.sin(ang);
      let mn = Infinity, mxp = -Infinity;
      for (const p of region) { const t = ((p % w) - mx) * c + (((p / w) | 0) - my) * s; if (t < mn) mn = t; if (t > mxp) mxp = t; }
      const length = mxp - mn;
      if (length < REFINE.MIN_SEG_LEN) continue;
      segs.push({ angle: ang * 180 / Math.PI, length, mx, my });
    }
    return segs;
  }

  // Per-blade REFINE overrides. Blade 1 (thin dark-blue handle) is the tuned
  // baseline and has NO override — an EXACT no-op. Blades 2 & 3 have THICKER
  // handles (measured on the checkerboard photos: blade1 0.85in, blade2 1.29in ≈
  // 1.52×, blade3 1.20in ≈ 1.41×), so their handle WALLS sit farther from the
  // base→axis line than blade1's. The baseline MAX_PERP_DIST (22px, tuned for
  // blade1) then rejects the true walls and a stray finger edge near the axis can
  // win — the finger-occlusion angle errors. Scale MAX_PERP_DIST by the measured
  // thickness ratio so the real walls are admitted again; the angle-agreement
  // (ANGLE_TOL_DEG) + consensus (CONSENSUS_DEG) gates still reject crossing finger
  // edges (they aren't parallel to the handle). Nothing else changes: blade2 is
  // dark/high-contrast (existing MAG_THRESH fine), blade3's low silver contrast is
  // already handled by the adaptive SILVER_MULT threshold in detectSegments.
  const REFINE_BLADE = {
    2: { MAX_PERP_DIST: 33 },              // 22 × 1.52 (black handle, 1.29in)
    // Blade 3 (silver) still occasionally slips under finger occlusion. Give it a
    // LARGER search patch (45→58) so it can find handle-wall segments ABOVE/BELOW
    // the finger where the wall is un-occluded — the length-weighted circular mean
    // is then dominated by the long real walls instead of the short finger edge —
    // plus a hair more perp tolerance (31→33) so the thick silver walls are fully
    // admitted. Only blade 3; blades 1 & 2 unchanged.
    3: { MAX_PERP_DIST: 33, PATCH_R: 58 },  // silver handle, 1.20in
  };
  function bladeRefine(blade) { return Object.assign({}, REFINE, REFINE_BLADE[blade] || {}); }

  // Refine the coarse angle (deg) from patch edges. baseLocal = base in patch px.
  // R = per-blade params (bladeRefine(blade)); defaults to the baseline REFINE so
  // callers that don't pass it (and blade 1) are unchanged.
  // Returns { angle(deg, full 360), nLines } or null if no confident reading.
  function refineAngle(gray, w, h, baseLocal, coarseAngleDeg, R) {
    R = R || REFINE;
    const segs = detectSegments(gray, w, h);
    const dx = Math.cos(coarseAngleDeg * Math.PI / 180), dy = Math.sin(coarseAngleDeg * Math.PI / 180);
    const good = [];
    for (const sg of segs) {
      if (sg.length < R.MIN_SEG_LEN) continue;
      if (_circDiff180(sg.angle, coarseAngleDeg) > R.ANGLE_TOL_DEG) continue;
      const perp = Math.abs((sg.mx - baseLocal[0]) * dy - (sg.my - baseLocal[1]) * dx);
      if (perp > R.MAX_PERP_DIST) continue;
      good.push([sg.angle, sg.length]);
    }
    if (good.length < 2) return null;   // one segment could be a stray finger edge
    let spread = 0;
    for (const [a] of good) for (const [b] of good) spread = Math.max(spread, _circDiff180(a, b));
    if (spread > R.CONSENSUS_DEG) return null;   // mixed signal
    // Length-weighted circular mean mod 180 (double-angle trick).
    let vx = 0, vy = 0;
    for (const [a, wgt] of good) { vx += wgt * Math.cos(2 * a * Math.PI / 180); vy += wgt * Math.sin(2 * a * Math.PI / 180); }
    let refined = _mod180(Math.atan2(vy, vx) * 180 / Math.PI / 2);
    // Resolve the 180° ambiguity using the coarse direction (full 360°).
    if (_circDiff180(refined, coarseAngleDeg) > 90) refined = _mod180(refined + 180);
    const cands = [refined, refined + 180];
    let best = cands[0], bestD = Infinity;
    for (const a of cands) { const dd = Math.abs(((a - coarseAngleDeg + 180) % 360) - 180); if (dd < bestD) { bestD = dd; best = a; } }
    return { angle: best, nLines: good.length };
  }

  // EMA + outlier gate on the refined angle (unit vector so it never wraps). On
  // a turn > maxTurnDeg it HOLDS the last value — but only for up to `resetAfter`
  // consecutive frames, then RE-ACQUIRES (snaps to the new reading). Without the
  // re-acquire, a real handle rotation (or a bad initial lock) would leave it
  // stuck on a stale angle forever — the cause of the 40–90° errors.
  class BladeAngleSmoother {
    // MOTION-ADAPTIVE smoothing (a cheap 1€-filter-style EMA): the blend alpha
    // shrinks toward alpha·restFactor when the handle is nearly still — so tiny
    // frame-to-frame wobble (the visible ANGLE JITTER) is smoothed hard — and
    // grows back to the full `alpha` as the per-frame turn approaches
    // motionRefDeg, so a genuine handle rotation is followed with NO extra lag.
    // Pure arithmetic, no history buffer → negligible cost. A turn > maxTurnDeg
    // still holds briefly then re-acquires so it never sticks on a stale angle.
    constructor(alpha = 0.2, maxTurnDeg = 30, resetAfter = 4, restFactor = 0.3, motionRefDeg = 10) {
      this.alpha = alpha; this.maxTurnDeg = maxTurnDeg; this.resetAfter = resetAfter;
      this.restFactor = restFactor; this.motionRefDeg = motionRefDeg;
      this.vec = null; this.held = 0;
    }
    reset() { this.vec = null; this.held = 0; }
    current() { return this.vec ? Math.atan2(this.vec[1], this.vec[0]) * 180 / Math.PI : null; }
    update(angleDeg) {
      const r = angleDeg * Math.PI / 180, u = [Math.cos(r), Math.sin(r)];
      if (!this.vec) { this.vec = u; this.held = 0; return angleDeg; }
      const cross = this.vec[0] * u[1] - this.vec[1] * u[0], dot = this.vec[0] * u[0] + this.vec[1] * u[1];
      const turn = Math.abs(Math.atan2(cross, dot)) * 180 / Math.PI;
      if (turn > this.maxTurnDeg) {
        if (++this.held < this.resetAfter) return this.current();   // brief hold
        this.vec = u; this.held = 0; return angleDeg;               // re-acquire
      }
      this.held = 0;
      // Adaptive blend: aMin (heavy) when still → aMax (this.alpha) on real turns.
      const aMax = this.alpha, aMin = this.alpha * this.restFactor;
      const a = aMin + (aMax - aMin) * Math.min(1, turn / this.motionRefDeg);
      this.vec = [(1 - a) * this.vec[0] + a * u[0], (1 - a) * this.vec[1] + a * u[1]];
      const m = Math.hypot(this.vec[0], this.vec[1]) || 1e-6;
      this.vec = [this.vec[0] / m, this.vec[1] / m];
      return this.current();
    }
  }

  // Browser-only: extract a grayscale patch (2r×2r, clamped) around a full-frame
  // point. Returns { gray, w, h, baseLocal:[x,y] } or null.
  let _gc = null, _gcx = null;
  function extractGrayPatch(srcEl, cxPx, cyPx, r, dims) {
    const W = dims.w, H = dims.h;
    let x0 = Math.max(0, Math.min(Math.round(cxPx - r), W - 1));
    let y0 = Math.max(0, Math.min(Math.round(cyPx - r), H - 1));
    const x1 = Math.max(0, Math.min(Math.round(cxPx + r), W - 1));
    const y1 = Math.max(0, Math.min(Math.round(cyPx + r), H - 1));
    const pw = x1 - x0, ph = y1 - y0;
    if (pw < 10 || ph < 10) return null;
    if (!_gc) { _gc = document.createElement('canvas'); _gcx = _gc.getContext('2d', { willReadFrequently: true }); }
    if (_gc.width !== pw || _gc.height !== ph) { _gc.width = pw; _gc.height = ph; }
    _gcx.imageSmoothingEnabled = false;
    _gcx.drawImage(srcEl, x0, y0, pw, ph, 0, 0, pw, ph);
    const rgba = _gcx.getImageData(0, 0, pw, ph).data;
    const gray = new Float32Array(pw * ph);
    for (let i = 0; i < pw * ph; i++) gray[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    return { gray, w: pw, h: ph, baseLocal: [cxPx - x0, cyPx - y0] };
  }

  const api = { IMGSZ, CROP, CONF, decodeBest, decodeToCrop, rgbaCropToTensor,
                angleRad, angleDeg, computeWindows, extractCropRGBA, detect, BladeSmoother,
                REFINE, REFINE_BLADE, bladeRefine, detectSegments, refineAngle, BladeAngleSmoother, extractGrayPatch };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node / main process
  if (root && root.document) root.BladeTracker = api;                        // browser
})(typeof window !== 'undefined' ? window : globalThis);
