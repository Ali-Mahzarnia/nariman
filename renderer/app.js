// ═══════════════════════════════════════════════════════════════════
//  NARIMAN — app.js
//  All measurement state lives here; Canvas layers are composited
//  each frame.  No framework, no build step.
// ═══════════════════════════════════════════════════════════════════

'use strict';

// ── Constants ────────────────────────────────────────────────────────
const LOUPE_RADIUS   = 90;   // px, display radius of loupe circle
const LOUPE_ZOOM     = 4;    // magnification factor
const LOUPE_SRC_R    = LOUPE_RADIUS / LOUPE_ZOOM; // source radius in video pixels

const STEP_COARSE = 1    * Math.PI / 180;  // 1° per key/wheel notch (normal)
const STEP_FINE   = 0.125 * Math.PI / 180;  // 0.125° per key/wheel notch (Shift)

const CM_PER_IN = 2.54;
// Dot radius in physical canvas pixels — tiny but crisp on all DPR displays
const DOT_R = Math.round(1.0 * (window.devicePixelRatio || 1));

// Embedded factory template — typical adult Mac 3 blade dimensions.
// Used as fallback if no Define L has been saved to localStorage yet.
const DEFAULT_TEMPLATE = {
  handleLen: 14.2, bladeLen: 13.0, jointAngle: 1.83,
  p1: null, p2: null, p3: null, gp1: null, gp2: null, gridInches: null,
};

// Embedded blade templates baked into the app so they are ALWAYS available.
//   T1 = blade 1 (blade_checkerboard.jpeg)
//   T2 = blade 2 — NEW, defined on blade_checkerboard2.jpeg (placeholder until the
//        user calibrates it and sends values to embed; starts undefined so the
//        Define L2 tab opens the 5-click definition)
//   T3 = blade 3 = the former blade 2 (blade_checkerboard3.jpeg)
//   T4 = custom blade (Define Lc, user-loaded board)
const EMBEDDED_TEMPLATE_1 = {"handleLen":14.841843716731587,"bladeLen":6.1039658909972205,"jointAngle":1.5790566934683339,"p1":{"x":0.3584377634272642,"y":0.7902799102842007},"p2":{"x":0.33490467696290943,"y":0.22756615787572249},"p3":{"x":0.6435823473627178,"y":0.22375568250240838},"gp1":{"x":0.1604938132225431,"y":0.24127622982899802},"gp2":{"x":0.1696561897880538,"y":0.433851532394027},"gridInches":2};
// blade 2 — jointAngle pre-flipped (negated) so it bends the same way as blade 1
const EMBEDDED_TEMPLATE_2 = {"handleLen":13.852085199766536,"bladeLen":6.380648592629,"jointAngle":1.5934223307349686,"p1":{"x":0.6733277874228394,"y":0.7769820601851857},"p2":{"x":0.6786868248456791,"y":0.24562355324074084},"p3":{"x":0.35258728780864224,"y":0.2552806712962964},"gp1":{"x":0.17983723958333334,"y":0.15725023674242425},"gp2":{"x":0.17077986900252531,"y":0.35200343276515156},"gridInches":2};
const EMBEDDED_TEMPLATE_3 = {"handleLen":16.566152709321297,"bladeLen":5.703269126796066,"jointAngle":1.5203074910160919,"p1":{"x":0.6163293931543796,"y":0.7810197759207652},"p2":{"x":0.6135827020201978,"y":0.22956202651515162},"p3":{"x":0.3613470643939396,"y":0.2455723248106061},"gp1":{"x":0.1846857244318182,"y":0.1751964962121212},"gp2":{"x":0.1906620896464647,"y":0.34424242424242424},"gridInches":2};
const EMBEDDED_TEMPLATE_4 = {"handleLen":19.701252386332527,"bladeLen":12.372765279101742,"jointAngle":1.5911411660466162,"p1":{"x":0.3549382716049383,"y":0.7916666666666666},"p2":{"x":0.3395061728395062,"y":0.041666666666666664},"p3":{"x":0.9675925925925926,"y":0.04398148148148148},"gp1":{"x":0.1574074074074074,"y":0.24074074074074073},"gp2":{"x":0.16666666666666666,"y":0.4340277777777778},"gridInches":2};
// Embedded secondary-view defaults (from omsni_defs1.json) so F / finger / horizon
// are present out of the box; they appear once a secondary video is loaded.
const EMBEDDED_SECF        = {"p1":{"x":0.4984375,"y":0.4648148148148148},"p2":{"x":0.5005208333333333,"y":0.4740740740740741}};
const EMBEDDED_SECFINGER   = {"p1":{"x":0.48802083333333335,"y":0.5333333333333333},"p2":{"x":0.5057291666666667,"y":0.5259259259259259}};
const EMBEDDED_SECHORIZON  = {"p1":{"x":0.3255208333333333,"y":0.6962962962962962},"p2":{"x":0.5994791666666667,"y":0.7012008101851852}};
// The single "default" defaults set, baked in so a fresh install has exactly one
// loadable ref (templates + secondary + scale; per-subject points left empty).
const EMBEDDED_DEFAULTS = {
  eye:    {"x":0.6145833333333334,"y":0.2962962962962963},
  thumb:  {"x":0.6708333333333333,"y":0.30185185185185187},
  horizon:{"p1":{"x":0.6364583333333333,"y":0.4151765046296295},"p2":{"x":0.7697916666666667,"y":0.4074074074074074}},
  hip:    {"shoulder":{"x":0.5125,"y":0.26666666666666666},"hip":{"x":0.428125,"y":0.4648148148148148},"frontKnee":{"x":0.48020833333333335,"y":0.737037037037037},"rearKnee":{"x":0.5083333333333333,"y":0.7148148148148148}},
  lfit:   {"base":{"x":0.6747395833333335,"y":0.2607494212962964},"joint":{"x":0.6535471251760173,"y":0.32871778852720934},"angleOffset":-3.166290379258509,"videoPxPerCm":5.666365949211762},
  scale:  {"p1":{"x":0.6061197916666665,"y":0.4439091435185185},"p2":{"x":0.63828125,"y":0.43994502314814815},"cm":10.16,"videoPxPerCm":6.092346048403509},
  templates: { 1: EMBEDDED_TEMPLATE_1, 2: EMBEDDED_TEMPLATE_2, 3: EMBEDDED_TEMPLATE_3, 4: EMBEDDED_TEMPLATE_4 },
  activeTemplate: 1,
  secF: EMBEDDED_SECF, secFinger: EMBEDDED_SECFINGER, secHorizon: EMBEDDED_SECHORIZON,
};

// ── State ─────────────────────────────────────────────────────────────
const state = {
  // Video players
  primary:   makeVideoState('primary'),
  secondary: makeVideoState('secondary'),

  // Shared frame (lockstep)
  frame: 0,

  // Measurement layers — each is independently editable
  scale: null,      // { p1, p2, cm, videoPxPerCm } — videoPxPerCm is resolution-invariant
  repose: null,     // { origin, angle }  — blade re-posed on measurement frame
  eye: null,        // { x, y }
  horizon: null,    // { p1, p2 }
  thumb: null,      // { x, y }  — operator thumb reference point
  hip: null,        // { shoulder, hip, frontKnee, rearKnee } — each {x,y} normalised

  // the pose model Pose (PRIMARY view, toggle). Off by default. Runs per-frame on
  // demand; the result for the current frame lives in poseCurrent and is only
  // persisted into poseCache when the user fine-tunes a point on that frame.
  poseEnabled: false,
  poseCurrent: null,   // { frame, landmarks:[{x,y,visibility}×33]|null, edited }
  poseCache: {},       // frame → landmarks[] (fine-tuned frames only; persists)
  poseInflight: null,  // frame currently being detected (de-dupe guard)
  poseDetCache: new Map(), // frame → raw landmarks[] (rolling, size-capped — for smoothing reuse)
  poseFront: (localStorage.getItem('omsni-pose-front') === 'L' ? 'L' : 'R'), // sticky front-of-body dir
  poseAutoRight: 'B',  // last auto image-right chain (anti-flicker memory for near-ties)
  poseSmooth: 30, // temporal window (frames)

  // L-template: fixed physical shape from 3-point reference definition.
  // `template` always points at the ACTIVE slot (state.templates[activeTemplate]).
  template: null,   // { handleLen_cm, bladeLen_cm, jointAngle_rad }
  templates: { 1: null, 2: null, 3: null, 4: null }, // blades 1,2,3 + custom(4)
  activeTemplate: 1,               // which slot drives Fit L (1,2,3, or 4=custom)
  definingTemplate: 1,             // transient: which slot the Define L flow writes to
  // L-fit: template fitted to a frame via 2 visible handle clicks
  lfit: null,       // { base, joint, angleOffset, videoPxPerCm }  base+joint normalised

  // SECONDARY-view rotation angles (independent of primary; normalized to the
  // secondary video). Each is a 2-point line; angle = signed tilt from vertical.
  secF: null,       // { p1, p2 } — blade roll ("f" mark)
  secFinger: null,  // { p1, p2 } — finger roll
  secHorizon: null, // { p1, p2 } — secondary-view horizon (reference for F/finger)

  // Checkerboard reference overlay shown on the PRIMARY canvas without seeking
  // the video. which ∈ null | 'L1' | 'L2' | 'custom'; img is the loaded Image.
  checker: { which: null, img: null, customUrl: null },
  hideVideo: false,      // black out video frames; all overlays (pose, CC, measurements) still render

  // Per-layer visibility — toggle with step button; data is kept when hidden
  visible: { scale: false, repose: true, eye: true, horizon: true, template: true, lfit: true, thumb: true, hip: true, secF: true, secFinger: true, secHorizon: true },

  // Arrow-key fine-tune: id of the selected point chip (null = frame navigation)
  selectedPointId: null,

  // Global display units — all stored values stay in cm internally
  units: 'cm',      // 'cm' | 'in'

  // Active tool mode
  mode: null,       // 'set-scale-draw'|'set-scale-done'|'repose-move'|'repose-rotate'|
                    // 'eye'|'horizon-p1'|'horizon-p2'|
                    // 'template-grid-p1'|'template-grid-p2'|
                    // 'template-p1'|'template-p2'|'template-p3'|'lfit-p1'|'lfit-p2'

  // Scratchpad for in-progress gestures
  scratch: {},

  // Undo stack — each entry is a deep clone of the measurement layers
  undoStack: [],

  // Loupe visibility per panel
  loupeVisible: { primary: false, secondary: false },
  mousePos: { primary: null, secondary: null },

  // Range/Segments save-load layer (Part A: plumbing only).
  segFile: null,        // { name, path } active segment file, or null
  segments: [],         // [{ name, start, end, computed, stats:{L,R}, warnings:[] }]
  currentSegment: 0,    // index of the selected segment in the dropdown
  segExcluded: [],      // excluded frame numbers (ignored in stats)
  exportMarks: [],      // frames where Export XLSX was clicked (scrollbar dots)
  exportDefs: {},       // frame → snapshotState() captured at each XLSX export
  compute: { running: false, paused: false, mode: null, segIdx: -1, frame: null }, // 'all' | 'play' | 'audio-play'
  _segData: {},         // in-memory per-segment per-frame angles (not saved; for stats/warnings)
  audioEnabled: localStorage.getItem('omsni-audio-enabled') === '1',    // unmute + RVFC play mode (only at 1x speed)
  audioTranscript: null,  // { words, segments } loaded from whisper scan
  ccEnabled: false,       // show CC subtitle overlay on primary canvas
  roi: null,              // {x, y, w, h} normalized (0-1) video coords for pose ROI, or null
  roiEnabled: false,      // ROI drawing-mode toggle
  _roiDraw: null,         // {start, end} ephemeral rect-draw state
  bladeTrackerEnabled: false, // run the trained blade-pose model on each frame → Fit L
  bladeSmoothEnabled: true, // temporal smoothing + outlier gate on base/angle
  bladeRefineEnabled: true, // LSD line-refinement of the handle angle (post-model)
  bladeDebug: false,        // draw the raw model base+direction arrow (magenta)
  _bladeDebug: null,        // { base, angle, handleVP } last raw detection
  _bladeInflight: false,  // guard against overlapping blade inferences
  _bladeToken: 0,         // invalidates stale detections when the frame changes
  bladeRoi: null,         // {x,y,w,h} normalized — SEPARATE from the pose ROI; only the
                          // blade tracker uses it, so it never alters the pose overlay
  bladeRoiEnabled: false, // Blade-ROI draw/show mode
  _bladeRoiDraw: null,    // {start,end} ephemeral rect-draw state
  bladeExcluded: [],      // blade-specific excluded frames for subsegment stats
                          // (separate from pose's segExcluded — different signal)
  _bladeStatsExpandedIdx: null,   // which segment row has its blade stats expanded (transient, not saved)
  // ── Eye tracker ──────────────────────────────────────────────────────────
  // The red eye marker is tied to the pose's RIGHT eye by a stored similarity
  // transform (offset in the local eye frame), so it follows the head in play/
  // compute/jump. eyeOffset persists; enabled state is transient (off on load).
  eyeTrackerEnabled: false,
  eyeOffset: null,        // { a, b } — red eye in the pose right-eye local frame
  eyeExcluded: [],        // frames excluded from eye subsegment stats
  _eyeArming: false,      // waiting for the user to click-place the eye after enabling
  _eyePinned: null,       // { frame,x,y } — a manual eye edit that wins on THAT frame
                          // (so fine-tuning isn't overwritten by the live tracker)
};

function makeVideoState(id) {
  return {
    id,
    el: null,       // <video> (null when an image is loaded)
    imgEl: null,    // <img>   (null when a video is loaded)
    isImage: false,
    ready: false,
    fps: 30,
    totalFrames: 0,
    seeking: false,
    pendingFrame: null,
  };
}

// Returns the native pixel dimensions of whatever is loaded in a panel.
// While the checkerboard overlay is active on primary, report ITS dimensions so
// Define L and the letterbox rect match the displayed board exactly.
function getNativeDims(id) {
  if (id === 'primary' && state.checker.which && state.checker.img && state.checker.img.complete && state.checker.img.naturalWidth)
    return { w: state.checker.img.naturalWidth, h: state.checker.img.naturalHeight };
  const vs = state[id];
  if (vs.isImage && vs.imgEl) return { w: vs.imgEl.naturalWidth,  h: vs.imgEl.naturalHeight };
  if (!vs.isImage && vs.el)   return { w: vs.el.videoWidth,       h: vs.el.videoHeight };
  return null;
}

// ── Unit helpers ─────────────────────────────────────────────────────
// All measurement state is stored in cm. These convert for display only.
function toCm(userVal) { return state.units === 'in' ? userVal * CM_PER_IN : userVal; }
function fromCm(cm)    { return state.units === 'in' ? cm / CM_PER_IN : cm; }
function fmtDist(cm)   {
  return state.units === 'in'
    ? `${(cm / CM_PER_IN).toFixed(3)} in`
    : `${cm.toFixed(3)} cm`;
}

// ── DOM refs ──────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  canvasPrimary:    $('canvas-primary'),
  canvasSecondary:  $('canvas-secondary'),
  overlayPrimary:   $('overlay-primary'),
  overlaySecondary: $('overlay-secondary'),
  loupePrimary:     $('loupe-primary'),
  loupeSecondary:   $('loupe-secondary'),
  sliderPrimary:    $('slider-primary'),
  sliderSecondary:  $('slider-secondary'),
  tcMmPrimary:   $('tc-mm-primary'),   tcSsPrimary:  $('tc-ss-primary'),
  tcMsPrimary:   $('tc-ms-primary'),   tcFrPrimary:  $('tc-fr-primary'),
  tcTotPrimary:  $('tc-tot-primary'),
  tcMmSecondary: $('tc-mm-secondary'), tcSsSecondary: $('tc-ss-secondary'),
  tcMsSecondary: $('tc-ms-secondary'), tcFrSecondary: $('tc-fr-secondary'),
  tcTotSecondary: $('tc-tot-secondary'),
  fpsPrimary:     $('fps-primary'),
  fpsSecondary:   $('fps-secondary'),
  fpsStatusPrimary:   $('fps-status-primary'),
  fpsStatusSecondary: $('fps-status-secondary'),
  wrapPrimary:   $('wrap-primary'),
  wrapSecondary: $('wrap-secondary'),
  modalScale:     $('modal-scale'),
  inputBladeCm:   $('input-blade-cm'),
  lblScaleUnit:   $('lbl-scale-unit'),
  modalGridScale: $('modal-grid-scale'),
  inputGridInches: $('input-grid-inches'),
  roBladAngle:   $('ro-blade-angle'),
  roHorizonAngle: $('ro-horizon-angle'),
  roEyeAngle:    $('ro-eye-angle'),
  roEyeDist:     $('ro-eye-dist'),
  roScale:       $('ro-scale'),
  roSecF:        $('ro-secf'),
  roSecFinger:   $('ro-secfinger'),
  pointPanel:    $('point-panel'),
  modalExportXl: $('modal-export-xl'),
  inputXlSubj:   $('input-xl-subj'),
  inputXlPhase:  $('input-xl-phase'),
  inputXlTrial:  $('input-xl-trial'),
};

// ── Video element factory ─────────────────────────────────────────────
function makeVideoEl() {
  const v = document.createElement('video');
  v.muted    = true;
  v.preload  = 'auto';
  v.style.display = 'none';
  document.body.appendChild(v);
  return v;
}

// ── Frame-accurate seek ───────────────────────────────────────────────
// Chromium parks exactly on the requested frame after seeked.
// We serialize seeks: if already seeking, store the latest request and
// apply it once the current seek completes.
function seekTo(vs, frame) {
  if (vs.isImage) return;  // static image: no seek needed
  frame = Math.max(0, Math.min(frame, vs.totalFrames - 1));
  if (vs.seeking) {
    vs.pendingFrame = frame;
    return;
  }
  vs.seeking = true;
  vs.el.currentTime = frame / vs.fps;
}

function onSeeked(vs) {
  vs.seeking = false;
  drawFrame(vs);
  if (vs.pendingFrame !== null) {
    const f = vs.pendingFrame;
    vs.pendingFrame = null;
    seekTo(vs, f);
  } else if (vs.id === 'primary') {
    schedulePose();       // run Pose on this newly-settled frame (no-op when toggle off)
    scheduleBladeTrack(); // run the blade-pose model on this frame (no-op when toggle off)
  }
}

function drawFrame(vs) {
  const canvas = vs.id === 'primary' ? els.canvasPrimary : els.canvasSecondary;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const rect = getVideoRect(vs.id);
  // Primary checkerboard overlay replaces the displayed frame (video time is NOT
  // touched) so Define L can be done on the board, then toggled off to return.
  if (vs.id === 'primary' && state.checker.which && state.checker.img && state.checker.img.complete) {
    ctx.drawImage(state.checker.img, rect.x, rect.y, rect.w, rect.h);
  } else if (!state.hideVideo) {
    const src = vs.isImage ? vs.imgEl : vs.el;
    if (src) ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h);
  }
  drawOverlay(vs.id);
  updateLoupeIfVisible(vs.id);
}

// Show/hide a checkerboard reference on the primary canvas. Toggling the same
// board off restores the video frame; the video's time/frame is never changed.
function setChecker(which, url) {
  if (state.checker.which === which) {           // toggle current board off
    state.checker.which = null;
    redrawPrimaryChecker();
    return;
  }
  const img = new Image();
  img.onload = () => { state.checker.which = which; state.checker.img = img; redrawPrimaryChecker(); };
  img.onerror = () => alert('Could not load that checkerboard image.');
  img.src = url;
}

function redrawPrimaryChecker() {
  updateStepButtonStates();
  const vs = state.primary;
  // Redraw the primary canvas; if no video is loaded yet, paint board directly.
  if (vs.ready) { drawFrame(vs); return; }
  const canvas = els.canvasPrimary, ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (state.checker.which && state.checker.img?.complete) {
    const rect = getVideoRect('primary');
    ctx.drawImage(state.checker.img, rect.x, rect.y, rect.w, rect.h);
  }
  drawOverlay('primary');
}

// Returns the letterboxed area of the video within the canvas (uniform scale, centered)
function getVideoRect(id) {
  const canvas = id === 'primary' ? els.canvasPrimary : els.canvasSecondary;
  const dims = getNativeDims(id);
  if (!dims || !dims.w || !dims.h) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const s = Math.min(canvas.width / dims.w, canvas.height / dims.h);
  const w = dims.w * s, h = dims.h * s;
  return { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w, h };
}

// ── Go to frame (both panels in lockstep) ────────────────────────────
function goToFrame(frame) {
  state.frame = frame;
  updateSliderAndLabel('primary', frame);
  updateSliderAndLabel('secondary', frame);
  if (state.primary.ready)   seekTo(state.primary, frame);
  if (state.secondary.ready) seekTo(state.secondary, frame);
}

function updateSliderAndLabel(id, frame) {
  const vs = state[id];
  const slider = id === 'primary' ? els.sliderPrimary : els.sliderSecondary;
  slider.value = frame;
  const fps = vs.fps || 30;
  const t   = frame / fps;
  const mm  = Math.floor(t / 60);
  const ss  = Math.floor(t) % 60;
  const ms  = Math.floor((t % 1) * 1000);
  const tot = Math.max(vs.totalFrames - 1, 0);
  if (id === 'primary') {
    els.tcMmPrimary.value = mm;   els.tcSsPrimary.value = ss;
    els.tcMsPrimary.value = ms;   els.tcFrPrimary.value = frame;
    els.tcTotPrimary.textContent = `/ ${tot}`;
  } else {
    els.tcMmSecondary.value = mm; els.tcSsSecondary.value = ss;
    els.tcMsSecondary.value = ms; els.tcFrSecondary.value = frame;
    els.tcTotSecondary.textContent = `/ ${tot}`;
  }
}

// ── Load video or static image ────────────────────────────────────────
async function loadVideo(id) {
  const url = await window.api.openVideo();
  if (!url) return;
  await loadVideoUrl(id, url);
}

async function loadVideoUrl(id, url) {
  const vs = state[id];
  // Reset previous media
  if (vs.el) { vs.el.src = ''; vs.el = null; }
  vs.imgEl   = null;
  vs.isImage = false;
  vs.ready   = false;

  // New primary media → drop pose results from the old video (and its sampler).
  if (id === 'primary') {
    state.poseCurrent = null; state.poseCache = {}; state.poseDetCache = new Map();
    if (_poseSampler) { try { _poseSampler.el.src = ''; } catch (e) {} _poseSampler = null; }
  }

  // Route to image loader if the file is a static image
  if (/\.(jpe?g|png|gif|bmp|webp)($|\?)/i.test(url)) {
    const canvas  = id === 'primary' ? els.canvasPrimary  : els.canvasSecondary;
    const overlay = id === 'primary' ? els.overlayPrimary : els.overlaySecondary;
    const wrap    = id === 'primary' ? els.wrapPrimary    : els.wrapSecondary;
    vs.isImage   = true;
    vs.totalFrames = 1;
    vs.fps = 1;
    const img = new Image();
    vs.imgEl  = img;
    img.onload = () => {
      vs.ready = true;
      resizeCanvasToWrap(canvas, overlay, wrap);
      updateSliderAndLabel(id, 0);
      drawFrame(vs);
      setFpsStatus(id, 'image');
      new ResizeObserver(() => { resizeCanvasToWrap(canvas, overlay, wrap); drawFrame(vs); }).observe(wrap);
    };
    img.onerror = () => {};
    img.src = url;
    return;
  }

  vs.el = makeVideoEl();
  vs.el.addEventListener('seeked', () => onSeeked(vs));

  vs.el.src = url;
  vs.el.load();

  vs.el.addEventListener('loadedmetadata', async () => {
    // Initialise with 30 fps so the UI is usable immediately
    applyFps(id, 30);
    vs.ready = true;
    if (id === 'primary') { updateComputeBtns(); updateAudioToggleState(); }
    // (Define L visibility is left as-is on video load — it's a normal toggleable
    // layer now, controlled only by the Define L / Define L2 buttons.)
    // Parse subject # from filename. Tries in order:
    //   "... 19 CAM 2.mp4" → digit(s) just before CAM keyword (handles "NARIMAN VIDEO 19 CAM 2")
    //   "NARIMAN 24 ..." → digit(s) right after the app name (legacy prefixes accepted too)
    //   "subj19..." / "subj 19..." → explicit subj prefix
    if (id === 'primary') {
      const fn = decodeURIComponent(url).split(/[/\\]/).pop();
      const m = fn.match(/(\d+)\s+cam\b/i)
             || fn.match(/(?:omsni|nariman)[^0-9]*(\d+)/i)
             || fn.match(/subj[a-z]*\s*(\d+)/i);
      if (m) localStorage.setItem('omsni-xl-subj', m[1]);
    }

    const canvas  = id === 'primary' ? els.canvasPrimary  : els.canvasSecondary;
    const overlay = id === 'primary' ? els.overlayPrimary : els.overlaySecondary;
    const wrap    = id === 'primary' ? els.wrapPrimary    : els.wrapSecondary;
    resizeCanvasToWrap(canvas, overlay, wrap, vs.el);

    updateSliderAndLabel(id, state.frame);
    seekTo(vs, state.frame);

    new ResizeObserver(() => resizeCanvasToWrap(canvas, overlay, wrap, vs.el))
      .observe(wrap);

    // ── Fps detection ──────────────────────────────────────────────
    setFpsStatus(id, 'detecting…');

    // 1. Try mp4 container metadata (fast, exact)
    let detected = null;
    try {
      const raw = await window.api.detectFps(url);
      if (raw && raw > 1 && raw < 300) detected = raw;
    } catch (e) {}

    if (detected !== null) {
      applyFps(id, detected);
      setFpsStatus(id, 'detected');
      return;
    }

    // 2. Fallback: measure via requestVideoFrameCallback
    setFpsStatus(id, 'measuring…');
    try {
      const measured = await measureFpsRVFC(vs.el);
      applyFps(id, measured);
      setFpsStatus(id, 'measured');
    } catch (e) {
      applyFps(id, 30);
      setFpsStatus(id, 'default 30');
    }
  }, { once: true });
}

// Common fps values used for snapping RVFC measurements
const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];

function snapToCommonFps(fps) {
  return COMMON_FPS.reduce((best, c) => Math.abs(c - fps) < Math.abs(best - fps) ? c : best);
}

function measureFpsRVFC(videoEl) {
  return new Promise((resolve, reject) => {
    const TARGET = 30; // collect 30 frame intervals
    const times  = [];

    const onFrame = (_, meta) => {
      times.push(meta.mediaTime);
      if (times.length <= TARGET) {
        videoEl.requestVideoFrameCallback(onFrame);
      } else {
        videoEl.pause();
        videoEl.currentTime = 0;
        const diffs = [];
        for (let i = 1; i < times.length; i++) diffs.push(times[i] - times[i - 1]);
        diffs.sort((a, b) => a - b);
        const median = diffs[Math.floor(diffs.length / 2)];
        if (median <= 0) return reject(new Error('bad frame times'));
        resolve(snapToCommonFps(1 / median));
      }
    };

    videoEl.currentTime = Math.min(1, (videoEl.duration || 10) * 0.05);
    videoEl.play()
      .then(() => videoEl.requestVideoFrameCallback(onFrame))
      .catch(reject);

    setTimeout(() => reject(new Error('RVFC timeout')), 12000);
  });
}

function applyFps(id, fps) {
  const vs     = state[id];
  const input  = id === 'primary' ? els.fpsPrimary   : els.fpsSecondary;
  vs.fps        = fps;
  vs.totalFrames = vs.el ? Math.floor(vs.el.duration * fps) : 0;
  input.value   = fps.toFixed(3);
  const slider  = id === 'primary' ? els.sliderPrimary : els.sliderSecondary;
  slider.max    = Math.max(0, vs.totalFrames - 1);
  updateSliderAndLabel(id, state.frame);
  if (id === 'primary' && typeof drawSegBars === 'function') drawSegBars();
}

function setFpsStatus(id, text) {
  const el = id === 'primary' ? els.fpsStatusPrimary : els.fpsStatusSecondary;
  el.textContent = text;
}

function resizeCanvasToWrap(canvas, overlay, wrap, videoEl) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = wrap.clientWidth;
  const cssH = wrap.clientHeight;
  const phW  = Math.round(cssW * dpr);
  const phH  = Math.round(cssH * dpr);

  canvas.width  = phW;  canvas.height  = phH;
  canvas.style.width  = cssW + 'px';  canvas.style.height = cssH + 'px';
  overlay.width = phW;  overlay.height = phH;
  overlay.style.width = cssW + 'px';  overlay.style.height = cssH + 'px';

  // Loupe canvases — physical pixels, styled at CSS size
  const loupeSz  = LOUPE_RADIUS * 2;
  const loupePh  = Math.round(loupeSz * dpr);
  const id = canvas.id.includes('primary') ? 'primary' : 'secondary';
  const loupeEl = id === 'primary' ? els.loupePrimary : els.loupeSecondary;
  loupeEl.width  = loupePh;
  loupeEl.height = loupePh;
  loupeEl.style.width  = loupeSz + 'px';
  loupeEl.style.height = loupeSz + 'px';

  // Redraw after resize
  const vs = state[id];
  if (vs.ready && !vs.seeking) drawFrame(vs);
}

// ── Overlay drawing ───────────────────────────────────────────────────
function drawSubtitle(ctx, text, rect) {
  const dpr   = window.devicePixelRatio || 1;
  const fsize = Math.round(14 * dpr);
  ctx.save();
  ctx.font = `bold ${fsize}px system-ui`;
  const maxW  = rect.w * 0.88;
  const words = text.split(' ');
  const lines = []; let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  const lineH = fsize * 1.5, pad = Math.round(6 * dpr);
  const botY  = rect.y + rect.h - pad;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  lines.forEach((l, i) => {
    const tw = ctx.measureText(l).width;
    const y  = botY - (lines.length - 1 - i) * lineH - fsize;
    ctx.fillRect(rect.x + (rect.w - tw) / 2 - pad, y - 2, tw + pad * 2, lineH);
  });
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, rect.x + rect.w / 2, botY - (lines.length - 1 - i) * lineH - fsize));
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

function drawOverlay(panelId) {
  const overlay = panelId === 'primary' ? els.overlayPrimary : els.overlaySecondary;
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (panelId !== 'primary') {        // secondary draws only its own rotation angles
    drawSecondaryOverlay(ctx, getVideoRect('secondary'), overlay);
    return;
  }

  const rect = getVideoRect(panelId);

  // Eye tracker: reconstruct the red eye from the current pose BEFORE it's drawn.
  if (typeof applyEyeTracking === 'function') applyEyeTracking();

  if (state.scale && state.visible.scale)
    drawScaleLine(ctx, state.scale.p1, state.scale.p2, rect);

  if ((state.mode === 'set-scale-draw' || state.mode === 'set-scale-done') && state.scratch.p1 && state.scratch.p2)
    drawScaleLine(ctx, state.scratch.p1, state.scratch.p2, rect);

  if (state.repose && state.visible.repose)
    drawReposedBlade(ctx, rect);

  if (state.eye && state.visible.eye) {
    const p = toCanvas(state.eye, rect);
    drawDot(ctx, p.x, p.y, '#f03e3e', Math.max(1, Math.round(DOT_R * 0.5)), '');
  }

  if (state.thumb && state.visible.thumb) {
    const tp = toCanvas(state.thumb, rect);
    drawDot(ctx, tp.x, tp.y, '#fd7e14', Math.max(1, Math.round(DOT_R * 0.5)), '');
    // Orange connector: finger → foot on the perpendicular-through-base line,
    // i.e. parallel to the handle trajectory (the measured distance).
    const fp = fingerBaseProjection();
    if (fp) {
      const footC = toCanvas(fp.foot, rect);
      ctx.save();
      ctx.strokeStyle = 'rgba(253,126,20,0.7)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(tp.x, tp.y); ctx.lineTo(footC.x, footC.y); ctx.stroke();
      ctx.restore();
    } else {
      // Fallback (no fit handle): plain dashed line to base/origin
      const baseNorm = state.lfit?.base ?? state.repose?.origin;
      if (baseNorm) {
        const bp = toCanvas(baseNorm, rect);
        ctx.save();
        ctx.strokeStyle = 'rgba(253,126,20,0.6)'; ctx.lineWidth = 0.8; ctx.setLineDash([4,4]);
        ctx.beginPath(); ctx.moveTo(tp.x, tp.y); ctx.lineTo(bp.x, bp.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }

  if (state.horizon && state.visible.horizon) {
    const a = toCanvas(state.horizon.p1, rect);
    const b = toCanvas(state.horizon.p2, rect);
    drawHorizonLine(ctx, a, b, overlay.width, overlay.height);
  }

  if (state.mode === 'horizon-p2' && state.scratch.p1) {
    const a = toCanvas(state.scratch.p1, rect);
    if (state.scratch.p2) {
      const b = toCanvas(state.scratch.p2, rect);
      drawHorizonLine(ctx, a, b, overlay.width, overlay.height);
    } else {
      drawDot(ctx, a.x, a.y, '#ffd43b', DOT_R, '');
    }
  }

  // Define L is a normal layer: show its lines whenever the active blade template
  // has click-points and its visibility is on — on BOTH image and video. While
  // actively defining, show the in-progress preview instead.
  const _tmplMode = ['template-grid-p1','template-grid-p2','template-p1','template-p2','template-p3'].includes(state.mode);
  if (_tmplMode)
    drawTemplatePreview(ctx, rect);
  else if (state.template?.p1 && state.visible.template)
    drawTemplateRef(ctx, rect);

  // Fitted L-shape (independent layer, its own visibility toggle)
  if (state.lfit && state.visible.lfit)
    drawLFit(ctx, rect);

  // Draw angle geometry lines (blade axis extension, eye connector, angle arcs)
  drawAngleLines(ctx, rect, overlay.width, overlay.height);

  // the pose model Pose overlay (toggle) — full skeleton + LEFT/RIGHT hip angles
  if (state.poseEnabled) { syncPoseCurrentToFrame(); drawPose(ctx, rect); }

  // Blade-excluded frame label — mirrors pose's "⌫ FRAME EXCLUDED" (drawn on the
  // LEFT inside drawPose) but on the RIGHT, since the blade exclusion list is a
  // SEPARATE signal. Shows on any frame the user marked with Exclude (Blade), so
  // it's clear which frames the blade subsegment stats are skipping.
  if ((state.bladeExcluded || []).includes(state.frame)) {
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    const txt = '⌫ BLADE EXCLUDED';
    ctx.font = `bold ${Math.round(14 * dpr)}px system-ui`;
    const padX = 10 * dpr, padY = 5 * dpr, fh = 14 * dpr;
    const boxW = ctx.measureText(txt).width + padX * 2, boxH = fh + padY * 2;
    const bx = rect.x + rect.w - 8 * dpr - boxW, by = rect.y + 8 * dpr;
    ctx.fillStyle = 'rgba(0,0,0,0.62)';   // dark pill (matches the pose buffering label)
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 12 * dpr); ctx.fill(); }
    else ctx.fillRect(bx, by, boxW, boxH);
    ctx.fillStyle = '#ff6b6b';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, bx + padX, by + boxH / 2);
    ctx.restore();
  }
  // Eye-excluded frame label — TOP-CENTER on the primary video, its own list.
  if ((state.eyeExcluded || []).includes(state.frame)) {
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    const txt = '👁 EYE EXCLUDED';
    ctx.font = `bold ${Math.round(14 * dpr)}px system-ui`;
    const padX = 10 * dpr, boxW = ctx.measureText(txt).width + padX * 2, boxH = 14 * dpr + 10 * dpr;
    const bx = rect.x + rect.w / 2 - boxW / 2, by = rect.y + 8 * dpr;
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 12 * dpr); ctx.fill(); }
    else ctx.fillRect(bx, by, boxW, boxH);
    ctx.fillStyle = '#ff6b6b';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, bx + padX, by + boxH / 2);
    ctx.restore();
  }

  // On-screen step instructions for multi-click tools
  const _instr = {
    'template-grid-p1': 'Define L — (1/5) Click first grid reference point',
    'template-grid-p2': 'Define L — (2/5) Click second grid reference point',
    'template-p1':      'Define L — (3/5) Click blade BASE',
    'template-p2':      'Define L — (4/5) Click blade JOINT (bend point)',
    'template-p3':      'Define L — (5/5) Click blade TIP',
    'lfit-p1':          'Fit L — Click to place the L shape, then drag / +− to scale / [ ] to rotate',
  };
  if (_instr[state.mode]) drawInstruction(ctx, _instr[state.mode], overlay.width);

  // Highlight the selected fine-tune point with a white ring and bold name label
  // (primary-panel points only — secondary points are ringed in drawSecondaryOverlay)
  if (state.selectedPointId) {
    const pts = getActivePoints();
    const sp = pts.find(p => p.id === state.selectedPointId && p.panel !== 'secondary');
    if (sp) {
      const dpr = window.devicePixelRatio || 1;
      const cp = toCanvas(sp.get(), rect);
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cp.x, cp.y, Math.round(10 * dpr), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(13 * dpr)}px system-ui`;
      ctx.fillText(`▶ ${sp.name}`, cp.x + Math.round(14 * dpr), cp.y - Math.round(10 * dpr));
      ctx.restore();
    }
  }

  // CC subtitle from loaded transcript
  if (state.ccEnabled && state.audioTranscript?.segments?.length) {
    const sec = (state.frame || 0) / (state.primary.fps || 30);
    const seg = state.audioTranscript.segments.find(s => sec >= s.startSec && sec <= s.endSec);
    if (seg) drawSubtitle(ctx, seg.text, rect);
  }

  // ROI rectangle — show while drawing (preview) or when active
  const _roiBox = (state._roiDraw?.end)
    ? { x: Math.min(state._roiDraw.start.x, state._roiDraw.end.x),
        y: Math.min(state._roiDraw.start.y, state._roiDraw.end.y),
        w: Math.abs(state._roiDraw.end.x - state._roiDraw.start.x),
        h: Math.abs(state._roiDraw.end.y - state._roiDraw.start.y) }
    : (state.roiEnabled ? state.roi : null);
  if (_roiBox) {
    const rp = toCanvas({ x: _roiBox.x, y: _roiBox.y }, rect);
    ctx.save();
    ctx.strokeStyle = '#20c997'; ctx.lineWidth = 2; ctx.setLineDash([6, 3]);
    ctx.strokeRect(rp.x, rp.y, _roiBox.w * rect.w, _roiBox.h * rect.h);
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Blade ROI — a SEPARATE region (dashed blue) used only by the blade tracker.
  const _bladeBox = (state._bladeRoiDraw?.end)
    ? { x: Math.min(state._bladeRoiDraw.start.x, state._bladeRoiDraw.end.x),
        y: Math.min(state._bladeRoiDraw.start.y, state._bladeRoiDraw.end.y),
        w: Math.abs(state._bladeRoiDraw.end.x - state._bladeRoiDraw.start.x),
        h: Math.abs(state._bladeRoiDraw.end.y - state._bladeRoiDraw.start.y) }
    : (state.bladeRoiEnabled ? state.bladeRoi : null);
  if (_bladeBox) {
    const bp = toCanvas({ x: _bladeBox.x, y: _bladeBox.y }, rect);
    ctx.save();
    ctx.strokeStyle = '#4dabf7'; ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(bp.x, bp.y, _bladeBox.w * rect.w, _bladeBox.h * rect.h);
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Raw blade-model output (magenta): the base dot + handle-direction arrow
  // exactly as the model reports it — the same thing 08_predict.py draws. Lets
  // you see whether the MODEL is right (arrow lies on the real handle) vs. the
  // constructed Fit L. Shown while the tracker is on and debug is enabled.
  if (state.bladeTrackerEnabled && state.bladeDebug && state._bladeDebug) {
    const d = state._bladeDebug;
    const b = toCanvas(d.base, rect);
    const len = Math.max(40, (d.handleVP || 0) * (rect.w / (getNativeDims('primary')?.w || rect.w)));
    const tip = { x: b.x + Math.cos(d.angle) * len, y: b.y + Math.sin(d.angle) * len };
    ctx.save();
    ctx.strokeStyle = '#f000ff'; ctx.fillStyle = '#f000ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    // arrowhead
    const ah = 8, a = d.angle;
    ctx.beginPath(); ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - ah * Math.cos(a - 0.4), tip.y - ah * Math.sin(a - 0.4));
    ctx.lineTo(tip.x - ah * Math.cos(a + 0.4), tip.y - ah * Math.sin(a + 0.4));
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();
  }

  updateReadout(rect);
}

// Normalised coords (0-1 relative to the letterbox rect) ↔ canvas px
function toCanvas(pt, rect) { return { x: rect.x + pt.x * rect.w, y: rect.y + pt.y * rect.h }; }
function toNorm(x, y, rect) { return { x: (x - rect.x) / rect.w,  y: (y - rect.y) / rect.h }; }

function drawScaleLine(ctx, p1, p2, rect) {
  const a = toCanvas(p1, rect), b = toCanvas(p2, rect);
  ctx.save();
  ctx.strokeStyle = '#4dabf7';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([6, 3]);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.setLineDash([]);
  drawDot(ctx, a.x, a.y, '#4dabf7', DOT_R, '');
  drawDot(ctx, b.x, b.y, '#4dabf7', DOT_R, '');
  if (state.scale) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    ctx.fillStyle = '#4dabf7';
    ctx.font = '11px system-ui';
    ctx.fillText(`${fromCm(state.scale.cm).toFixed(2)} ${state.units}`, mid.x + 6, mid.y - 6);
  }
  ctx.restore();
}

function drawReposedBlade(ctx, rect) {
  if (!state.scale) return;
  const dims = getNativeDims('primary');
  if (!dims) return;
  const { origin, angle } = state.repose;
  const o = toCanvas(origin, rect);

  // Blade length in canvas pixels — scale by rect.w / videoWidth for display-size invariance
  const canvasPxPerCm = state.scale.videoPxPerCm * (rect.w / dims.w);
  const bladeLen = state.scale.cm * canvasPxPerCm;

  const dx = Math.cos(angle), dy = Math.sin(angle);
  const tip  = { x: o.x + dx * bladeLen,         y: o.y + dy * bladeLen };
  const tail = { x: o.x - dx * (bladeLen * 0.3), y: o.y - dy * (bladeLen * 0.3) };

  ctx.save();
  ctx.strokeStyle = '#51cf66';
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(tail.x, tail.y); ctx.lineTo(o.x, o.y); ctx.stroke();

  ctx.strokeStyle = '#69db7c';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
  ctx.setLineDash([]);

  drawDot(ctx, o.x, o.y, '#51cf66', DOT_R, '');
  drawDot(ctx, tip.x, tip.y, '#a9e34b', DOT_R, '');

  // Live angle label near origin
  ctx.font = 'bold 11px system-ui';
  ctx.fillStyle = '#51cf66';
  ctx.fillText(`${radToDeg(angle).toFixed(2)}°`, o.x + 9, o.y - 9);

  ctx.restore();
}

function drawHorizonLine(ctx, a, b, W, H) {
  ctx.save();
  ctx.strokeStyle = '#ffd43b';
  ctx.lineWidth = 0.8;
  const ext = extendLine(a, b, W, H);
  ctx.setLineDash([8, 4]);
  ctx.beginPath(); ctx.moveTo(ext.x1, ext.y1); ctx.lineTo(ext.x2, ext.y2); ctx.stroke();
  ctx.setLineDash([]);
  drawDot(ctx, a.x, a.y, '#ffd43b', DOT_R, '');
  drawDot(ctx, b.x, b.y, '#ffd43b', DOT_R, '');
  // Midpoint handle: drag to translate the whole line
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  drawDot(ctx, mx, my, '#ffd43b', DOT_R, '');
  ctx.restore();
}

// Draws the three angle-measurement lines + arcs so the user can see
// exactly what geometry is being measured.
function drawAngleLines(ctx, rect, W, H) {
  const dims = getNativeDims('primary');
  if (!dims) return;

  let o, angle, bladeLen, handleAngle;
  if (state.repose && state.scale && state.visible.repose) {
    const canvasPxPerCm = state.scale.videoPxPerCm * (rect.w / dims.w);
    o       = toCanvas(state.repose.origin, rect);
    angle   = state.repose.angle;
    bladeLen = state.scale.cm * canvasPxPerCm;
    handleAngle = angle; // no separate handle point in repose mode
  } else if (state.lfit && state.template && state.visible.lfit) {
    const tip = getLFitTip(); if (!tip) return;
    const { w: vW, h: vH } = dims;
    const { base, angleOffset } = state.lfit;
    const joint = getLFitJoint();             // scale-driven handle endpoint
    const θH = Math.atan2((joint.y - base.y) * vH, (joint.x - base.x) * vW);
    handleAngle = θH; // direction base→joint for arc a
    angle    = θH + state.template.jointAngle + angleOffset;
    o        = toCanvas(joint, rect);
    bladeLen = state.template.bladeLen * fitVPpcm() * (rect.w / vW);
  } else {
    return;
  }
  const dpr      = window.devicePixelRatio || 1;
  const ARC_R    = Math.max(Math.min(bladeLen * 0.55, 180), 70);
  const ARC_EYE  = ARC_R * 0.78;
  const FONT     = `bold ${Math.round(15 * dpr)}px system-ui`;
  const OFF      = 28;  // label offset past arc edge

  // Pre-compute horizon angle so both sections can use it
  const ha = (state.horizon && state.visible.horizon)
    ? horizonAngleRad(state.horizon.p1, state.horizon.p2, rect) : null;

  ctx.save();

  // ── 1. Extended blade axis (thin dashed) ─────────────────────────────────────
  ctx.strokeStyle = 'rgba(105,219,124,0.35)';
  ctx.lineWidth = 0.8; ctx.setLineDash([3, 6]);
  ctx.beginPath();
  ctx.moveTo(o.x - Math.cos(angle)*1000, o.y - Math.sin(angle)*1000);
  ctx.lineTo(o.x + Math.cos(angle)*1000, o.y + Math.sin(angle)*1000);
  ctx.stroke(); ctx.setLineDash([]);

  // ── 2. Horizon translated to joint + arc a (handle ↔ right horizon) — BLUE ──
  if (ha !== null) {
    const hExt = ARC_R * 2.2;
    ctx.strokeStyle = 'rgba(255,212,59,0.4)'; ctx.lineWidth = 0.8; ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(o.x - Math.cos(ha)*hExt, o.y - Math.sin(ha)*hExt);
    ctx.lineTo(o.x + Math.cos(ha)*hExt, o.y + Math.sin(ha)*hExt);
    ctx.stroke(); ctx.setLineDash([]);

    // arc a: pick whichever handle direction (forward or back) is closer to haRight
    // so the angle is invariant to F/mirror flipping the handle 180°
    const haRight = Math.cos(ha) >= 0 ? ha : ha + Math.PI;
    const hMirror = handleAngle + Math.PI;
    const useH = angleDiffDeg(handleAngle, haRight) <= angleDiffDeg(hMirror, haRight)
      ? handleAngle : hMirror;
    const degA = Math.min(angleDiffDeg(handleAngle, haRight), angleDiffDeg(hMirror, haRight));
    const a1a = Math.min(useH, haRight), a2a = Math.max(useH, haRight);
    let arcAa = a1a, arcBa = a2a;
    if (arcBa - arcAa > Math.PI) { arcAa = a2a; arcBa = a1a + Math.PI * 2; }
    ctx.strokeStyle = 'rgba(77,171,247,0.28)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(o.x - Math.cos(useH)*(ARC_R+OFF), o.y - Math.sin(useH)*(ARC_R+OFF));
    ctx.lineTo(o.x + Math.cos(useH)*(ARC_R+OFF), o.y + Math.sin(useH)*(ARC_R+OFF));
    ctx.stroke();
    ctx.strokeStyle = '#4dabf7'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(o.x, o.y, ARC_R, arcAa, arcBa); ctx.stroke();
    const midAa = (arcAa + arcBa) / 2;
    ctx.fillStyle = '#4dabf7'; ctx.font = FONT;
    const degAsigned = handleAngleToHorizonDeg(handleAngle, rect);   // SIGNED label (#4)
    ctx.fillText(`a ${(degAsigned != null ? degAsigned : degA).toFixed(1)}°`,
      o.x + Math.cos(midAa)*(ARC_R + OFF), o.y + Math.sin(midAa)*(ARC_R + OFF));
  }

  // ── 3. Eye-to-joint connector + arc c (eye→joint ↔ LEFT horizon) — RED ─────
  if (state.eye && state.visible.eye && ha !== null) {
    const ep = toCanvas(state.eye, rect);
    ctx.strokeStyle = 'rgba(240,62,62,0.7)'; ctx.lineWidth = 0.8; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(ep.x, ep.y); ctx.lineTo(o.x, o.y); ctx.stroke();
    ctx.setLineDash([]);

    const eyeAngle = Math.atan2(ep.y - o.y, ep.x - o.x); // direction joint→eye
    // arc c: eye direction vs LEFTWARD horizon (the other side)
    const haLeft = Math.cos(ha) >= 0 ? ha + Math.PI : ha;
    const a1c = Math.min(eyeAngle, haLeft), a2c = Math.max(eyeAngle, haLeft);
    let arcAc = a1c, arcBc = a2c;
    if (arcBc - arcAc > Math.PI) { arcAc = a2c; arcBc = a1c + Math.PI * 2; }
    ctx.strokeStyle = '#f03e3e'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(o.x, o.y, ARC_EYE, arcAc, arcBc); ctx.stroke();
    // Label parked a fixed nudge ABOVE the eye (not on the arc bisector, which
    // jumped around as the eye tracked) so the live "c" reading is easy to read.
    ctx.fillStyle = '#f03e3e'; ctx.font = FONT;
    ctx.save(); ctx.textAlign = 'center';
    ctx.fillText(`c ${angleDiffDeg(eyeAngle, haLeft).toFixed(1)}°`, ep.x, ep.y - (OFF + 6 * dpr));
    ctx.restore();
  }

  ctx.restore();
}


// ── the pose model Pose (primary view) ─────────────────────────────────────────
// 33-landmark BlazePose indices we care about. The shoulder→hip→knee chain on
// each side is drawn at full opacity; everything else is the faint skeleton.
const POSE_KEY_IDX = [11, 12, 23, 24, 25, 26];          // L/R shoulder, hip, knee
const POSE_CHAINS  = [[11, 23, 25], [12, 24, 26]];      // [shoulder, hip, knee] per side
let POSE_VIS_MIN = 0;  // min landmark visibility (slider-controlled 0–1)
const POSE_COL = { R: '#ff6b6b', L: '#4dabf7' };        // assigned-side colours

// Make poseCurrent reflect the displayed frame: prefer a fine-tuned cached
// result; otherwise drop a stale pose so we never show one frame's skeleton on
// another (the async detect fills it back in).
function syncPoseCurrentToFrame() {
  const f = state.frame;
  if (state.poseCache[f]) { state.poseCurrent = { frame: f, landmarks: state.poseCache[f], edited: true }; return; }
  if (state.poseCurrent && state.poseCurrent.frame !== f) state.poseCurrent = null;
}

// ── Temporal smoothing via the pose model VIDEO-mode tracking ────────────────────
// Instead of post-hoc median, we feed the pose model a short SEQUENTIAL run of frames
// [F-N+1 … F] in order with increasing timestamps so its internal tracker warms
// up, and take the result at F. The mini-run is replayed on every landing (no
// stale tracker state carried across random jumps). The final F result is cached
// per frame so revisiting a frame during scrubbing is instant.
const POSE_DET_CACHE_CAP = 600;        // rolling per-(frame,N) result cache size

function _poseKey(frame, N) { return frame + ':' + N; }

function poseDetCachePut(frame, N, arr) {
  const c = state.poseDetCache;
  const k = _poseKey(frame, N);
  if (c.has(k)) c.delete(k);
  c.set(k, arr);
  while (c.size > POSE_DET_CACHE_CAP) c.delete(c.keys().next().value);
}

// Drop all cached results for a given frame (all N values) — called on fine-tune/exclude.
function poseDetCacheInvalidateFrame(F) {
  const prefix = F + ':';
  for (const k of state.poseDetCache.keys()) {
    if (k.startsWith(prefix)) state.poseDetCache.delete(k);
  }
}

// Off-screen video mirroring the primary, so the warm-up frames can be seeked &
// fed without disturbing the displayed frame or the secondary lockstep.
let _poseSampler = null;
function poseSamplerEl() {
  const pv = state.primary;
  if (!pv.el || !pv.el.src) return null;
  if (_poseSampler && _poseSampler.src === pv.el.src) return _poseSampler;
  if (_poseSampler) { try { _poseSampler.el.src = ''; } catch (e) {} }
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.playsInline = true;
  const s = { el: v, src: pv.el.src, ready: false, onSeeked: null };
  v.addEventListener('seeked', () => { const cb = s.onSeeked; s.onSeeked = null; if (cb) cb(); });
  v.addEventListener('loadeddata', () => { s.ready = true; });
  v.src = pv.el.src; v.load();
  _poseSampler = s;
  return s;
}
// Safety timeout added (was previously unbounded — if 'loadeddata' never fires
// for any reason, this used to hang forever, wedging every caller that awaits
// it, including compute loops, permanently). Only adds a fallback resolve path;
// the success path (loadeddata fires normally) is unchanged.
function _samplerReady(s) {
  if (s.ready) return Promise.resolve();
  return new Promise(res => {
    let done = false;
    const fin = () => { if (done) return; done = true; s.el.removeEventListener('loadeddata', fin); res(); };
    s.el.addEventListener('loadeddata', fin);
    setTimeout(fin, 3000);
  });
}
function _seekSampler(s, frame) {
  return new Promise(res => {
    let done = false;
    const fin = () => { if (done) return; done = true; s.onSeeked = null; res(); };
    s.onSeeked = fin;
    s.el.currentTime = frame / (state.primary.fps || 30);
    setTimeout(fin, 1500); // safety if seeked never fires
  });
}

let _roiOffCanvas = null;
function _roiImg(videoEl) {
  if (!state.roi || !state.roiEnabled || !videoEl) return videoEl;
  const { x, y, w, h } = state.roi;
  const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
  if (!vw || !vh) return videoEl;
  const pw = Math.max(1, Math.round(w * vw)), ph = Math.max(1, Math.round(h * vh));
  if (!_roiOffCanvas) _roiOffCanvas = document.createElement('canvas');
  _roiOffCanvas.width = pw; _roiOffCanvas.height = ph;
  _roiOffCanvas.getContext('2d').drawImage(videoEl, Math.round(x * vw), Math.round(y * vh), pw, ph, 0, 0, pw, ph);
  return _roiOffCanvas;
}
function _remapROI(lms) {
  if (!lms || !state.roi || !state.roiEnabled) return lms;
  const { x, y, w, h } = state.roi;
  return lms.map(lm => ({ ...lm, x: x + lm.x * w, y: y + lm.y * h }));
}

function _toArr(lms) { return lms ? lms.map(p => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })) : null; }

// Which of an anatomical left/right landmark pair is the FRONT (more-forward)
// one — the one further along the horizon-right axis. Returns 'Right'/'Left'.
function poseForwardSide(L, rect, leftIdx, rightIdx) {
  if (!L[leftIdx] || !L[rightIdx]) return null;
  const lp = toCanvas(L[leftIdx], rect), rp = toCanvas(L[rightIdx], rect);
  let rx = 1, ry = 0;
  if (state.horizon?.p1 && state.horizon?.p2) {
    const h1 = toCanvas(state.horizon.p1, rect), h2 = toCanvas(state.horizon.p2, rect);
    rx = h2.x - h1.x; ry = h2.y - h1.y; if (rx < 0) { rx = -rx; ry = -ry; }
  }
  const len = Math.hypot(rx, ry) || 1; rx /= len; ry /= len;
  return (rp.x * rx + rp.y * ry) >= (lp.x * rx + lp.y * ry) ? 'Right' : 'Left';
}

// While Pose is on, set the Front-leg and Front-eye toggles from the pose each
// time we land on a frame (knees 25/26, eyes 2/5). Manual clicks on a still
// frame still win until the next navigation.
function updateFrontFromPose() {
  if (!state.poseEnabled || !state.poseCurrent?.landmarks) return;
  const rect = getVideoRect('primary'), L = state.poseCurrent.landmarks;
  const foot = poseForwardSide(L, rect, 25, 26); if (foot) setFrontFoot(foot);
  const eye  = poseForwardSide(L, rect, 2, 5);   if (eye)  setFrontEye(eye);
}

// ── Eye tracker ──────────────────────────────────────────────────────────────
// The red eye marker (state.eye) is tied to the pose's RIGHT eye (landmark 5) by
// a SIMILARITY transform captured in a local frame built from the two eyes (right
// eye 5 → left eye 2). Storing the red eye as (a,b) in that frame means it follows
// head translation, roll AND scale as the pose moves — so in play, compute, or any
// jumped frame we reconstruct the eye from the current pose. More robust than a raw
// pixel offset. Landmarks: 5 = right eye, 2 = left eye.
// Face anchors used to lock the eye to the head: nose, both eyes, both ears. Using
// SEVERAL points (not just the two eyes) fits a least-squares similarity that is far
// more stable under head height/rotation changes than a 2-point basis.
const EYE_ANCHORS = [0, 2, 5, 7, 8];
// Capture the current red eye + the current pose's usable anchor points (normalized).
function computeEyeOffset() {
  const L = state.poseCurrent?.landmarks;
  if (!L || !state.eye) return false;
  const ref = {};
  for (const i of EYE_ANCHORS) if (poseUsable(L, i)) ref[i] = [L[i].x, L[i].y];
  if (Object.keys(ref).length < 2) return false;
  state.eyeOffset = { refEye: { x: state.eye.x, y: state.eye.y }, ref };
  return true;
}
// Reconstruct the red eye from a pose by fitting a 2-D SIMILARITY (translation +
// rotation + uniform scale, closed-form Procrustes) that maps the reference anchors
// onto the current-frame anchors, then applying it to the reference eye. Uses only
// anchors usable in BOTH frames. Identity at the reference frame → exact reproduce.
function eyeFromPose(L, dims) {
  const off = state.eyeOffset;
  if (!off || !off.ref || !L || !dims) return null;
  const P = [], Q = [];
  for (const k of Object.keys(off.ref)) {
    const i = +k;
    if (poseUsable(L, i)) { P.push([off.ref[k][0] * dims.w, off.ref[k][1] * dims.h]); Q.push([L[i].x * dims.w, L[i].y * dims.h]); }
  }
  const n = P.length; if (n < 2) return null;
  let cpx = 0, cpy = 0, cqx = 0, cqy = 0;
  for (let k = 0; k < n; k++) { cpx += P[k][0]; cpy += P[k][1]; cqx += Q[k][0]; cqy += Q[k][1]; }
  cpx /= n; cpy /= n; cqx /= n; cqy /= n;
  let numc = 0, nums = 0, d = 0;
  for (let k = 0; k < n; k++) {
    const ax = P[k][0] - cpx, ay = P[k][1] - cpy, bx = Q[k][0] - cqx, by = Q[k][1] - cqy;
    numc += ax * bx + ay * by; nums += ax * by - ay * bx; d += ax * ax + ay * ay;
  }
  if (d < 1e-6) return null;
  const mx = numc / d, my = nums / d;            // complex multiplier s·e^{iθ}
  const vx = off.refEye.x * dims.w - cpx, vy = off.refEye.y * dims.h - cpy;
  return { x: (cqx + mx * vx - my * vy) / dims.w, y: (cqy + my * vx + mx * vy) / dims.h };
}
// A frame that was COMPUTED already has the exact tracked eye stored in bladeData —
// return it so hyperlinks/replays reproduce the reported value EXACTLY (like blade).
function findComputedEyeFrame(F) {
  for (const sg of state.segments) {
    const d = sg.bladeData && sg.bladeData[F];
    if (d && d.eye) return d.eye;
  }
  return null;
}
// Drive state.eye when the tracker is on. Prefers the STORED computed eye for a
// computed frame (exact, reproducible); otherwise reconstructs live from the pose.
// Skipped while the user drags the eye. Memoized per (frame,pose) so repeated
// redraws in the same frame don't recompute.
let _eyeApplied = { frame: -1, lm: null };
function applyEyeTracking(L) {
  if (!state.eyeTrackerEnabled) return;
  if (state.scratch && state.scratch.dragTarget === 'eye') return;
  // A manual edit on THIS frame wins over the tracker (so fine-tuning sticks).
  if (state._eyePinned && state._eyePinned.frame === state.frame) {
    state.eye = { x: state._eyePinned.x, y: state._eyePinned.y }; state.visible.eye = true; return;
  }
  const stored = findComputedEyeFrame(state.frame);
  if (stored) { state.eye = { x: stored.x, y: stored.y }; state.visible.eye = true; return; }
  if (!state.eyeOffset) return;
  const lms = L || (state.poseCurrent && state.poseCurrent.frame === state.frame ? state.poseCurrent.landmarks : null);
  if (!lms) return;
  if (_eyeApplied.frame === state.frame && _eyeApplied.lm === lms) return;   // already applied
  const dims = getNativeDims('primary'); if (!dims) return;
  const e = eyeFromPose(lms, dims);
  if (e) { state.eye = e; state.visible.eye = true; _eyeApplied = { frame: state.frame, lm: lms }; }
}
// Toggle the eye tracker. Cannot be changed during compute or play.
function toggleEyeTracker() {
  if (state.compute.running) { alert('Pause Play/Compute before changing the eye tracker.'); return; }
  if (state.eyeTrackerEnabled) { disableEyeTracker(); return; }
  const _ensurePose = () => { if (!state.poseEnabled) { state.poseEnabled = true; $('btn-pose')?.classList.add('active'); try { window.PoseEngine?.warmup?.(); } catch (e) {} ensurePoseForFrame(); } };
  // ALREADY CONFIGURED (offset set this session OR restored from the JSON file):
  // just resume tracking silently — no warning, no re-placing. Reproduces exactly
  // what was set before.
  if (state.eyeOffset) {
    _ensurePose();
    state.eyeTrackerEnabled = true; state._eyeArming = false;
    $('btn-eye-track')?.classList.add('active');
    state.visible.eye = true;
    applyEyeTracking(); drawBothOverlays(); segScheduleSave();
    return;
  }
  // FIRST-TIME setup: warn, ensure a pose, and arm the placement click.
  alert('Turn on a Pose at a still frame, then click to place the red eye marker on the front eye. It will then follow the pose in play / compute / frame jumps.');
  _ensurePose();
  state.eyeTrackerEnabled = true;
  $('btn-eye-track')?.classList.add('active');
  if (state.eye && computeEyeOffset()) { state._eyeArming = false; }
  else { state._eyeArming = true; setMode('eye'); }
  segScheduleSave();
}
function disableEyeTracker() {
  if (!state.eyeTrackerEnabled && !state._eyeArming) return;
  state.eyeTrackerEnabled = false; state._eyeArming = false; state._eyePinned = null;
  if (state.mode === 'eye') setMode(null);   // exit place-eye cleanly
  $('btn-eye-track')?.classList.remove('active');
}
// Eye (re)placed or dragged while the tracker is on → re-capture the offset and,
// if this frame has computed data, refresh its stored eye + the eye stats.
function onEyeMarkerMoved() {
  if (!state.eyeTrackerEnabled) return;
  if (computeEyeOffset()) state._eyeArming = false;
  // Pin the manual position on this frame so the live tracker can't snap it back.
  state._eyePinned = { frame: state.frame, x: state.eye.x, y: state.eye.y };
  const seg = segCurrent && segCurrent();
  if (seg && seg.bladeData && seg.bladeData[state.frame]) {
    seg.bladeData[state.frame].eye = { x: state.eye.x, y: state.eye.y };
    computeBladeSubStats(seg); segRenderPanel(); drawSegBars(); drawOverlay('primary');
  }
  segScheduleSave();
}
// Exclude the CURRENT frame from EYE subsegment stats (its own list).
function excludeCurrentFrameEye() {
  const F = state.frame;
  if (!state.eyeExcluded.includes(F)) state.eyeExcluded.push(F);
  const seg = segCurrent();
  if (seg && seg.bladeData) computeBladeSubStats(seg);
  openSegPanel();
  state._bladeStatsExpandedIdx = state.currentSegment;
  segRenderPanel(); drawSegBars(); drawOverlay('primary'); segScheduleSave();
}
// c-angle: (joint→eye) direction vs the horizon-left axis — same convention as the
// live "c" readout. Returns [0,180] deg, or null without a horizon.
function eyeJointHorizonDeg(eyeN, jointN, rect) {
  if (!eyeN || !jointN) return null;
  if (!(state.horizon && state.horizon.p1 && state.horizon.p2)) return null;
  const o = toCanvas(jointN, rect), ep = toCanvas(eyeN, rect);
  const eyeAngle = Math.atan2(ep.y - o.y, ep.x - o.x);
  const ha = horizonAngleRad(state.horizon.p1, state.horizon.p2, rect);
  const haLeft = Math.cos(ha) >= 0 ? ha + Math.PI : ha;
  return angleDiffDeg(eyeAngle, haLeft);
}

// Centered window [F-before … F … F+after] clamped to valid frames.
// If one side is clipped, the slack is taken from the opposite side.
// Sequential VIDEO-mode mini-run for frame F with causal window [F-(N-1) … F].
// Matches compute/play: only past frames feed the tracker, F is always last.
// Resets the tracker before every run so each interactive scrub is independent.
async function runVideoPose(F, N) {
  if (!window.PoseEngine) return null;
  if (state.compute.running) return undefined;  // abort stale interactive tasks queued before play/compute started
  await window.PoseEngine.reset();
  const start = Math.max(0, F - (N - 1));
  let resultAtF = null;
  let ts = 0;
  let s = null;
  if (start !== F) { s = poseSamplerEl(); if (s) await _samplerReady(s); }
  const _warmTotal = F - start + 1;
  for (let k = start; k <= F; k++) {
    if (!state.poseEnabled || state.frame !== F || state.poseCache[F]) return undefined;  // aborted
    if (start < F) { const _p = Math.round((k - start) / _warmTotal * 100); showBufferingLabel('Warming up… ' + _p + '%'); setBufferBar(_p); }
    let img;
    if (k === F) { img = state.primary.el; }
    else { if (!s) continue; await _seekSampler(s, k); img = s.el; }
    ts += 33;
    let res = null;
    try { res = await window.PoseEngine.detectForVideo(_roiImg(img), ts); } catch (e) {}
    if (k === F) resultAtF = res;
  }
  return _remapROI(_toArr(resultAtF));
}

// Serialize whole mini-runs so detectForVideo timestamps never interleave.
let _videoChain = Promise.resolve();
function scheduleVideoPose(F, N) {
  const run = () => runVideoPose(F, N);
  const p = _videoChain.then(run, run);
  _videoChain = p.catch(() => {});
  return p;
}

// Run pose for the current primary frame (debounced caller). Reuses the cached
// per-frame result when revisiting; otherwise runs the sequential video-mode pass.
function ensurePoseForFrame() {
  if (!state.poseEnabled) return;
  const vs = state.primary;
  if (!vs.ready || vs.isImage || !vs.el || state.checker.which) return;  // need a live video frame
  const F = state.frame;
  if (state.poseCache[F]) {                            // fine-tuned → override
    state.poseCurrent = { frame: F, landmarks: state.poseCache[F], edited: true };
    drawOverlay('primary'); updatePointPanel(); updatePoseReadout(); updateFrontFromPose(); return;
  }
  if (!window.PoseEngine) return;
  const N = Math.max(1, state.poseSmooth);
  const cacheKey = _poseKey(F, N);
  if (state.poseDetCache.has(cacheKey)) {              // already computed this (frame, N)
    state.poseCurrent = { frame: F, landmarks: state.poseDetCache.get(cacheKey), edited: false };
    drawOverlay('primary'); updatePointPanel(); updatePoseReadout(); updateFrontFromPose(); return;
  }
  // Check for a persisted compute landmark at this frame (key frames only — min/max per segment).
  // lmN must match current N so stale results from a different smoothing setting are ignored.
  for (const _s of (state.segments || [])) {
    if (_s._data?.[F]?.lmN === N && Array.isArray(_s._data[F].lm)) {
      const _lms = _s._data[F].lm;
      poseDetCachePut(F, N, _lms);
      state.poseCurrent = { frame: F, landmarks: _lms, edited: false };
      drawOverlay('primary'); updatePointPanel(); updatePoseReadout(); updateFrontFromPose(); return;
    }
  }
  if (N > 1) {
    showBufferingLabel('Warming up… 0%'); setBufferBar(0);
    // Instant interim: show the single current frame while the warm-up window
    // (which involves seeks) computes. The final displayed pose is the windowed one.
    scheduleVideoPose(F, 1).then(lms => {
      if (lms === undefined || !state.poseEnabled || state.frame !== F || state.poseCache[F] || state.poseDetCache.has(cacheKey)) return;
      state.poseCurrent = { frame: F, landmarks: lms, edited: false };
      drawOverlay('primary'); updatePointPanel(); updatePoseReadout();
    });
  }
  scheduleVideoPose(F, N).then(lms => {
    hideBufferingLabel(); hideBufferBar();
    if (lms === undefined) return;                     // aborted (user moved / edited)
    if (!state.poseEnabled || state.frame !== F || state.poseCache[F]) return;
    poseDetCachePut(F, N, lms);                        // final = sequential video-mode pass
    state.poseCurrent = { frame: F, landmarks: lms, edited: false };
    drawOverlay('primary'); updatePointPanel(); updatePoseReadout(); updateFrontFromPose();
  });
}

let _poseTimer = null;
function schedulePose() {
  if (!state.poseEnabled || state.compute.running) return;  // compute drives the pose itself
  clearTimeout(_poseTimer);
  _poseTimer = setTimeout(ensurePoseForFrame, 50);     // settle fast scrubbing before detecting
}

// ── Blade-pose tracker ──────────────────────────────────────────────────────
// When enabled, run the trained blade model (selected by the ACTIVE blade slot,
// state.activeTemplate ∈ {1,2,3}) on the current primary frame inside the Blade
// ROI, then drive Fit L from the detection: base = detected base keypoint,
// handle direction = detected angle. Size/bend/scale come from the template and
// are never changed. When the blade isn't detected, the Fit L is removed so the
// overlay honestly shows "no blade this frame" instead of a stale L.
let _bladeTimer = null;
// Remembers the Fit L size params across frames, so a re-acquired blade keeps
// the same size even though the L was cleared while it was missing.
let _bladeFitMemory = null;   // { videoPxPerCm, sizeMul, angleOffset }
let _bladeSmoother = null;    // BladeSmoother instance (lazy)
// Per-frame detection cache ("buffer"): frame → { baseN, angle, conf } | null.
// Only the accurate (refine) results are cached, so scrubbing back to a frame
// already tracked is instant and never re-runs the model.
let _bladeCache = new Map();
function bladeSmoother() {
  if (!_bladeSmoother && window.BladeTracker) _bladeSmoother = new window.BladeTracker.BladeSmoother();
  return _bladeSmoother;
}
let _bladeAngleSmoother = null;   // BladeAngleSmoother (refined-angle EMA + hold)
function bladeAngleSmoother() {
  if (!_bladeAngleSmoother && window.BladeTracker) _bladeAngleSmoother = new window.BladeTracker.BladeAngleSmoother(0.2); // lower alpha = more smoothing
  return _bladeAngleSmoother;
}
// Blade smoothing follows the pose-smooth window 1:1 (MATCH POSE EXACTLY). The
// old 4× multiplier made the blade window ~120 frames at the pose default, whose
// heavy EMA lagged visibly behind sudden handle moves. Effective blade window
// N = poseSmooth; baseAlpha is the reference alpha at a 30-frame window, so at
// the pose default (30) the blade smooths with baseAlpha itself.
function bladeAlphaFromN(baseAlpha) {
  const N = Math.max(1, state.poseSmooth || 30);
  return Math.max(0.02, Math.min(0.85, baseAlpha * 30 / N));
}
// Force a fresh re-track of the current frame NOW, bypassing the compute.running
// guard in scheduleBladeTrack — used for explicit user actions (retoggle, smooth
// change) so they always take effect even if that flag was left set.
function forceBladeRetrack() {
  if (!state.bladeTrackerEnabled) return;
  clearTimeout(_bladeTimer);
  state._bladeInflight = false;
  state._bladeToken++;
  _bladeTimer = setTimeout(() => runBladeTracker(false), 30);
}
// Throttle blade inference during PLAYBACK so it never runs every frame — that
// would starve the buffered pose playback. Blade still updates several ×/sec.
function bladeTrackDuringPlay() {
  if (!state.bladeTrackerEnabled) return;
  // Cache-first: the warm-start filled the cache with smoothed results, so replay
  // those (smooth from the first frame). Only compute when beyond the cache.
  const F = state.frame;
  if (_bladeCache.has(F)) {
    const dims = getNativeDims('primary');
    if (dims) applyBladeResult(_bladeCache.get(F), dims, false);   // play loop draws
    return;
  }
  if (state._bladeInflight) return;
  runBladeTracker(true);
}
// Reset everything the tracker remembers (smoother history + frame cache).
// Call whenever the blade, ROI, video, or smoothing setting changes.
function resetBladeTracker() {
  _bladeCache.clear();
  _bladeFitMemory = null;
  state._bladeInflight = false;   // clear a stuck in-flight guard (revives a dead tracker)
  state._bladeToken++;            // invalidate any pending detection
  bladeSmoother()?.reset();
  bladeAngleSmoother()?.reset();
}
// Clear the tracker-placed Fit L from the overlay (blade gone / tracker off).
// redraw=false during playback: only update state; the play loop redraws each
// frame (a second async redraw here races the loop → pose flicker).
function clearBladeFit(redraw = true) {
  state._bladeDebug = null;
  if (state.lfit) {
    _bladeFitMemory = { videoPxPerCm: state.lfit.videoPxPerCm, sizeMul: state.lfit.sizeMul || 1, angleOffset: state.lfit.angleOffset || 0 };
    state.lfit = null;
    if (redraw) { drawBothOverlays(); updatePointPanel(); }
    if (typeof segScheduleSave === 'function') segScheduleSave();
  }
  bladeReadout(null);
}
// Update the small conf/angle status shown in the Blade tracker toolbar group.
function bladeReadout(res) {
  const el = $('blade-readout'); if (!el) return;
  if (!res) { el.textContent = '—'; el.style.color = '#888'; return; }
  const deg = res.angle * 180 / Math.PI;
  el.textContent = `${res.conf.toFixed(2)} · ${deg.toFixed(0)}°`;
  el.style.color = res.conf >= 0.6 ? '#69db7c' : (res.conf >= 0.4 ? '#ffd43b' : '#ff8787');
}
function scheduleBladeTrack() {
  if (!state.bladeTrackerEnabled || state.compute.running) return;  // play loop drives blade during playback
  clearTimeout(_bladeTimer);
  state._bladeToken++;                       // any pending detection for an old frame is now stale
  _bladeTimer = setTimeout(() => runBladeTracker(false), 50);   // accurate (2-pass) when scrubbing
}

// Apply a detection result { baseN, angle, conf } | null to the Fit L overlay.
// redraw modes:
//   true   — full sync (button states + both overlays + point panel). Used by
//            Track/scrub (a per-USER-ACTION event, not a tight per-frame loop,
//            so the extra cost is negligible).
//   'lite' — cheap per-frame visual update ONLY (drawOverlay('primary')) — used
//            by the Compute loop, which calls this up to hundreds of times; the
//            full sync there was a real, measurable per-frame cost (rebuilding
//            the whole fine-tune chip panel's DOM every frame) that made
//            Compute feel much heavier than it needed to.
//   false  — state only, no draw (the caller's own loop draws once per frame).
function applyBladeResult(res, dims, redraw = true) {
  if (!res) { clearBladeFit(redraw === true); return; }
  const joint = { x: res.baseN.x + Math.cos(res.angle) / dims.w, y: res.baseN.y + Math.sin(res.angle) / dims.h };
  const src = state.lfit || _bladeFitMemory;
  // Necessary bend flip, applied via angleOffset each build (idempotent — no
  // oscillation, no template mutation, manual Fit L untouched). θblade = θhandle
  // + jointAngle + angleOffset; choosing angleOffset so θblade = θhandle −
  // |jointAngle| puts the blade on a FIXED side regardless of whether the stored
  // jointAngle sign was toggled earlier (embedded templates are all positive).
  const ja = state.template.jointAngle;
  state.lfit = {
    base: res.baseN,
    joint,
    angleOffset: -ja - Math.abs(ja),
    videoPxPerCm: (src && src.videoPxPerCm) || (state.scale ? state.scale.videoPxPerCm : (0.18 * dims.w / state.template.handleLen)),
    sizeMul: src ? (src.sizeMul || 1) : 1,
  };
  _bladeFitMemory = { videoPxPerCm: state.lfit.videoPxPerCm, sizeMul: state.lfit.sizeMul, angleOffset: state.lfit.angleOffset };
  state.visible.lfit = true;
  // Raw model output for the debug arrow (handle length in video px for arrow scale).
  state._bladeDebug = { base: res.baseN, angle: res.angle, handleVP: state.template.handleLen * fitVPpcm() };
  if (redraw === true) {
    if (typeof updateStepButtonStates === 'function') updateStepButtonStates();
    drawBothOverlays();
    updatePointPanel();
  } else if (redraw === 'lite') {
    drawOverlay('primary');
  }
  bladeReadout(res);
  if (typeof segScheduleSave === 'function') segScheduleSave();
}

// Detect + smooth one frame's blade on the given image element (main video OR
// the warm-up sampler). Returns { none:true } (no blade), { reject:true }
// (fast-mode outlier → hold previous L), or { res:{baseN,angle,conf} }. Updates
// the smoothers in place; does NOT cache or draw. `fast` skips the 2nd refine
// pass (playback). Shared by runBladeTracker and the warm-start pass.
async function bladeDetectAndSmooth(imgEl, roi, dims, blade, fast) {
  const det = await window.BladeTracker.detect(imgEl, roi, dims, blade, undefined, !fast);
  if (!det) { if (state.bladeSmoothEnabled) bladeSmoother()?.miss(); return { none: true }; }

  // Base-point smoothing + outlier gate (pixel space; direction as unit vector).
  let baseN = det.base, angle = det.angle;
  if (state.bladeSmoothEnabled) {
    const sm = bladeSmoother();
    if (sm) sm.alpha = bladeAlphaFromN(0.3);   // follows pose-smooth N
    let s = sm && sm.update([det.base.x * dims.w, det.base.y * dims.h], [Math.cos(det.angle), Math.sin(det.angle)]);
    if (sm && !s) {
      // Outlier: during play hold the previous L; when parked/warming re-acquire.
      if (fast) return { reject: true };
      sm.reset();
      s = sm.update([det.base.x * dims.w, det.base.y * dims.h], [Math.cos(det.angle), Math.sin(det.angle)]);
    }
    if (s) { baseN = { x: s.base[0] / dims.w, y: s.base[1] / dims.h }; angle = Math.atan2(s.dir[1], s.dir[0]); }
  }

  // LSD angle refinement: refine toward a confident handle-wall line, else follow
  // the moving smoothed raw angle (never a permanent hold).
  if (state.bladeRefineEnabled && window.BladeTracker.refineAngle) {
    // Per-blade refine params (blade 1 = baseline no-op; blades 2/3 widen
    // MAX_PERP_DIST for their thicker handles — see REFINE_BLADE in blade-tracker.js).
    const R = window.BladeTracker.bladeRefine ? window.BladeTracker.bladeRefine(blade) : window.BladeTracker.REFINE;
    const coarseDeg = det.angle * 180 / Math.PI;
    const smoothedRawDeg = angle * 180 / Math.PI;
    const patch = window.BladeTracker.extractGrayPatch(
      imgEl, baseN.x * dims.w, baseN.y * dims.h, R.PATCH_R, dims);
    const rr = patch ? window.BladeTracker.refineAngle(patch.gray, patch.w, patch.h, patch.baseLocal, coarseDeg, R) : null;
    const as = bladeAngleSmoother();
    if (as) {
      as.alpha = bladeAlphaFromN(0.2);
      const targetDeg = rr ? rr.angle : smoothedRawDeg;
      let finalDeg = as.update(targetDeg);
      const drift = finalDeg == null ? 0 : Math.abs(((finalDeg - coarseDeg + 180) % 360) - 180);
      if (finalDeg == null || drift > R.MAX_DRIFT_DEG) { as.reset(); finalDeg = as.update(targetDeg); }
      if (finalDeg != null) angle = finalDeg * Math.PI / 180;
    }
  }
  return { res: { baseN, angle, conf: det.conf } };
}

// fast=true skips the refine pass (single inference) — used during playback so
// the frame rate stays up; the smoother covers the extra single-pass noise.
// Find the batch-Computed blade result for frame F, if any segment's bladeData
// covers it (within that segment's OWN [start,end] — not just its subsegment,
// since Compute now stores data across the whole segment). Returns the stored
// entry (possibly null = "computed, no blade found"), or undefined if F was
// never computed by any segment.
function findComputedBladeFrame(F) {
  for (const sg of state.segments) {
    if (sg.bladeData && sg.start != null && sg.end != null && F >= sg.start && F <= sg.end
        && Object.prototype.hasOwnProperty.call(sg.bladeData, F)) {
      return sg.bladeData[F];
    }
  }
  return undefined;
}

async function runBladeTracker(fast) {
  if (!state.bladeTrackerEnabled || state._bladeInflight) return;
  if (!window.BladeTracker || !window.api?.bladeInfer) return;
  const blade = state.activeTemplate;
  if (!(blade === 1 || blade === 2 || blade === 3)) return;   // custom slot has no model
  // Blade ROI is optional: with no ROI drawn, track the WHOLE frame (like the
  // pose ROI's "on all" behaviour).
  const roi = state.bladeRoi || { x: 0, y: 0, w: 1, h: 1 };
  const vs = state.primary;
  if (!vs || !vs.ready || vs.isImage || !vs.el) return;
  const dims = getNativeDims('primary');
  if (!dims) return;
  if (!state.template) return;  // need the active blade template to place Fit L

  const F = state.frame;
  // If this EXACT frame has already been Computed (batch pass), show that
  // STORED result directly instead of re-detecting fresh. Without this, a
  // fresh live re-detect can legitimately disagree with the computed value
  // (different temporal-smoother history) — so a stats hyperlink would jump
  // you to a frame and show a DIFFERENT angle/position than what was reported,
  // and re-detecting also cost an extra async round-trip (the "click the
  // hyperlink multiple times" symptom). The computed value is authoritative
  // for that frame, so use it unconditionally when present.
  if (!fast) {
    const cd = findComputedBladeFrame(F);
    if (cd === null) { clearBladeFit(true); return; }              // computed: no blade this frame
    if (cd && cd.base && cd.angle != null) {                        // computed: show it directly
      applyBladeResult({ baseN: cd.base, angle: cd.angle, conf: cd.conf }, dims, true);
      return;
    }
    // else: not computed for this frame (undefined), or legacy-shaped data
    // with no raw angle — fall through to a live detect below.
  }

  const token = state._bladeToken;
  state._bladeInflight = true;
  // Safety: if inference ever hangs (e.g. a stalled IPC while pose competes),
  // release the guard so the tracker can't get permanently stuck.
  const _inflightSafety = setTimeout(() => { state._bladeInflight = false; }, 4000);
  let out = { none: true };
  try {
    if (fast) {
      // Play: single-frame detect — the continuous smoother + warm-start buffer
      // do the temporal smoothing across the played sequence.
      out = await bladeDetectAndSmooth(vs.el, roi, dims, blade, true);
    } else {
      // Scrub / land / pause: RESET the smoother, then take ONE accurate 2-pass
      // detect at this frame. A parked still frame's correct blade is just the
      // accurate detection there — resetting first makes it DETERMINISTIC (no
      // dependence on how playback reached this frame: the "re-toggle fixes this
      // frame" behavior, now automatic), and it's a single inference (no sampler
      // seeks) so it is fast and can't get stuck like a long causal walk. It also
      // reliably drops play-time FALSE POSITIVES on pause: if there's no blade
      // here, out.none → clearBladeFit removes the stale L.
      bladeSmoother()?.reset();
      bladeAngleSmoother()?.reset();
      out = await bladeDetectAndSmooth(vs.el, roi, dims, blade, false);
    }
  } catch (e) {
    console.error('[BladeTracker] detect failed:', e);
  } finally {
    clearTimeout(_inflightSafety);
    state._bladeInflight = false;
    if (!fast) hideBladeProgress();
  }
  // Drop the result if the frame moved or the toggle went off while we waited.
  if (token !== state._bladeToken || !state.bladeTrackerEnabled) return;
  if (out.reject) return;                       // fast-mode outlier → hold previous L
  if (out.none) { _bladeCache.set(F, null); clearBladeFit(!fast); return; }

  // Cache every frame (play too): playing a segment warms the smoother and fills
  // the cache, so parking/scrubbing to any played frame is instantly smooth.
  _bladeCache.set(F, out.res);
  applyBladeResult(out.res, dims, !fast);   // during play, let the play loop draw the L (no flicker)
}

// Blade warm-start: run [bufStart … bufEnd] through the blade pipeline in order
// (off-screen sampler for past frames, main video for the current one) so the
// smoother is warm and every frame's smoothed result is cached before playback —
// the blade analogue of the pose pre-buffer. Fills the RIGHT half of the buffer
// bar. Returns when done or aborted. Never touches pose.
// Blade's OWN off-screen sampler, separate from the pose one so blade warm-start
// can run CONCURRENTLY with the pose pre-buffer (different sampler, and the ONNX
// runs in the main process) without both fighting over one video element.
let _bladeSampler = null;
function bladeSamplerEl() {
  const pv = state.primary;
  if (!pv.el || !pv.el.src) return null;
  if (_bladeSampler && _bladeSampler.src === pv.el.src) return _bladeSampler;
  if (_bladeSampler) { try { _bladeSampler.el.src = ''; } catch (e) {} }
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.playsInline = true;
  const s = { el: v, src: pv.el.src, ready: false, onSeeked: null };
  v.addEventListener('seeked', () => { const cb = s.onSeeked; s.onSeeked = null; if (cb) cb(); });
  v.addEventListener('loadeddata', () => { s.ready = true; });
  v.src = pv.el.src; v.load();
  _bladeSampler = s;
  return s;
}
async function bladeWarmupBuffer(bufStart, bufEnd) {
  if (!state.bladeTrackerEnabled || !state.template) return;
  if (!window.BladeTracker || !window.api?.bladeInfer) return;
  const blade = state.activeTemplate;
  if (!(blade === 1 || blade === 2 || blade === 3)) return;
  const dims = getNativeDims('primary'); if (!dims) return;
  const roi = state.bladeRoi || { x: 0, y: 0, w: 1, h: 1 };
  const s = bladeSamplerEl(); if (s) await _samplerReady(s);
  resetBladeTracker();
  const total = Math.max(1, bufEnd - bufStart + 1);
  for (let k = bufStart; k <= bufEnd; k++) {
    if (state.compute.paused || !state.compute.running) return;   // user paused/aborted
    setBladeBufferBar(Math.round((k - bufStart + 1) / total * 100));
    let img;
    if (k === state.frame) img = state.primary.el;
    else { if (!s) continue; await _seekSampler(s, k); img = s.el; }
    let out = { none: true };
    try { out = await bladeDetectAndSmooth(img, roi, dims, blade, false); } catch (e) {}
    if (out.res) _bladeCache.set(k, out.res);
    else if (out.none) _bladeCache.set(k, null);
  }
  setBladeBufferBar(100);
}

// Once the user fine-tunes a point, freeze this frame's landmarks in the cache.
function markPoseEdited() {
  if (!state.poseCurrent || !state.poseCurrent.landmarks) return;
  state.poseCurrent.edited = true;
  const F = state.poseCurrent.frame;
  state.poseCache[F] = state.poseCurrent.landmarks;   // fine-tuned frame → saved in the segment file
  poseDetCacheInvalidateFrame(F);                      // drop all (F,N) cached auto-detections
  updatePoseReadout();
  if (typeof segOnFineTune === 'function') segOnFineTune(F);
  if (typeof segScheduleSave === 'function') segScheduleSave();
}

// R/L from the pose model's anatomical sides: 11/23/25 = subject's LEFT,
// 12/24/26 = RIGHT. A = chain[0] (11/23/25), B = chain[1] (12/24/26).
// Auto side assignment from the KNEES (they separate more than the hips in a
// side view): project both knees onto the horizon-right direction (tilted
// horizon if set, else image x). The knee with the larger right-projection is
// the leg on the image-right. When the two are nearly equal the result is
// ambiguous, so keep the previous decision to avoid flicker.
function poseAutoRightChain(L, rect) {
  const A = toCanvas(L[25], rect), B = toCanvas(L[26], rect);  // L/R knees
  let rx = 1, ry = 0;
  if (state.horizon?.p1 && state.horizon?.p2) {
    const h1 = toCanvas(state.horizon.p1, rect), h2 = toCanvas(state.horizon.p2, rect);
    rx = h2.x - h1.x; ry = h2.y - h1.y;
    if (rx < 0) { rx = -rx; ry = -ry; }                        // orient to image-right
  }
  const len = Math.hypot(rx, ry) || 1; rx /= len; ry /= len;
  const projA = A.x * rx + A.y * ry, projB = B.x * rx + B.y * ry;
  const eps = (rect.w || 1) * 0.003;                           // small band: only hold on a near-tie
  if (Math.abs(projA - projB) >= eps) state.poseAutoRight = projA > projB ? 'A' : 'B';
  return state.poseAutoRight;                                  // else keep previous (anti-flicker)
}

// R/L for the two chains. Default convention: the subject faces the camera, so
// the leg on the IMAGE-RIGHT is the subject's LEFT. The manual swap flips it.
// A = chain[0] (11/23/25), B = chain[1] (12/24/26).
function poseSideAssignment(L, rect) {
  // Pure per-frame auto: the leg on the IMAGE-RIGHT is labeled L (subject faces
  // camera). Re-decided every frame (self-correcting), no manual override.
  return poseAutoRightChain(L, rect) === 'A' ? { A: 'L', B: 'R' } : { A: 'R', B: 'L' };
}

// A landmark is usable only if confident AND inside the frame — this drops the
// hallucinated out-of-frame points (e.g. an ankle below the crop) that distort
// the skeleton and produce impossible marks.
function poseUsable(L, i) {
  const p = L[i];
  return !!p && p.visibility >= POSE_VIS_MIN && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}

// Per-chain anchor for the R/L badge: prefer a usable ankle/foot, else the knee.
function poseChainAnchorIdx(L, ci) {
  const cands = ci === 0 ? [27, 31, 29] : [28, 32, 30];
  for (const i of cands) if (poseUsable(L, i)) return i;
  return ci === 0 ? 25 : 26;
}

// Anterior (front-of-body) direction is a STICKY MANUAL choice (state.poseFront),
// never inferred per frame: 'R' = body faces image-right, 'L' = image-left.
function poseAnteriorVec() { return state.poseFront === 'L' ? { x: -1, y: 0 } : { x: 1, y: 0 }; }

// Hip arc (trunk→thigh) taken through the chosen anterior side, so the reading is
// the front-of-body hip angle. S/H/K are canvas points; ant is the front unit vec.
function poseHipArc(S, H, K, ant) {
  const aS = Math.atan2(S.y - H.y, S.x - H.x), aK = Math.atan2(K.y - H.y, K.x - H.x);
  let d = aK - aS;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;                 // minor signed sweep ∈ (−π, π]
  const mid = aS + d / 2;
  const minorIsAnterior = (Math.cos(mid) * ant.x + Math.sin(mid) * ant.y) >= 0;
  const sweep = minorIsAnterior ? d : (d > 0 ? d - 2 * Math.PI : d + 2 * Math.PI);
  return { aS, sweep, deg: Math.abs(sweep) * 180 / Math.PI, labMid: aS + sweep / 2 };
}

// Hip-angle info for a chain: the (anterior) arc, whether all three points are
// confident (visibility ≥ threshold AND in-frame), and the canvas points. The
// angle is ALWAYS reported; `confident:false` only drives a ⚠ warning.
function poseChainInfo(L, rect, sh, hip, kn) {
  const S = toCanvas(L[sh], rect), H = toCanvas(L[hip], rect), K = toCanvas(L[kn], rect);
  const confident = poseUsable(L, sh) && poseUsable(L, hip) && poseUsable(L, kn);
  return { arc: poseHipArc(S, H, K, poseAnteriorVec()), confident, S, H, K };
}

function drawPoseChain(ctx, rect, L, sh, hip, kn, color, label, dpr) {
  const { arc, confident, S, H, K } = poseChainInfo(L, rect, sh, hip, kn);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.globalAlpha = confident ? 1 : 0.85;
  // Chain (dashed when low-confidence). Angle is always drawn either way.
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, 2.4 * dpr);
  if (!confident) ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(S.x, S.y); ctx.lineTo(H.x, H.y); ctx.lineTo(K.x, K.y); ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = Math.max(1, 1 * dpr);
  ctx.beginPath();
  ctx.arc(H.x, H.y, Math.round(34 * dpr), arc.aS, arc.aS + arc.sweep, arc.sweep < 0);
  ctx.stroke();
  drawDot(ctx, S.x, S.y, color, DOT_R);
  drawDot(ctx, H.x, H.y, color, DOT_R);
  drawDot(ctx, K.x, K.y, color, DOT_R);
  // Label beside the wedge — nudged right of arc, L higher R lower so they don't overlap.
  const lx = H.x + Math.cos(arc.labMid) * Math.round(40 * dpr) + Math.round(18 * dpr);
  const ly = H.y + Math.sin(arc.labMid) * Math.round(40 * dpr) + (label === 'L' ? -Math.round(10 * dpr) : Math.round(10 * dpr));
  ctx.fillStyle = confident ? color : '#ffa94d';
  ctx.font = `bold ${Math.round(12 * dpr)}px system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(`${arc.deg.toFixed(1)}°${confident ? '' : ' ⚠'}`, lx, ly);
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

function drawPose(ctx, rect) {
  const pose = state.poseCurrent;
  if (!pose || pose.frame !== state.frame || !pose.landmarks) return;
  const L = pose.landmarks;
  const dpr = window.devicePixelRatio || 1;
  const excluded = (state.segExcluded || []).includes(state.frame);
  if (excluded) {
    ctx.save();
    ctx.globalAlpha = 0.9; ctx.fillStyle = '#f03e3e';
    ctx.font = `bold ${Math.round(15 * dpr)}px system-ui`;
    ctx.fillText('⌫ FRAME EXCLUDED', rect.x + 10 * dpr, rect.y + 22 * dpr);
    ctx.restore();
  }
  const conns = window.PoseEngine?.POSE_CONNECTIONS || [];
  const chainSeg = new Set();
  for (const [a, b, c] of POSE_CHAINS) { chainSeg.add(a + '-' + b); chainSeg.add(b + '-' + a); chainSeg.add(b + '-' + c); chainSeg.add(c + '-' + b); }

  ctx.save();
  // 1) Faint skeleton (alpha 0.5), excluding the highlighted chains and any
  //    out-of-frame / low-confidence landmark (drops hallucinated shins, etc.).
  ctx.globalAlpha = 0.5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#ced4da'; ctx.lineWidth = Math.max(1, 1.6 * dpr);
  for (const c of conns) {
    if (chainSeg.has(c.start + '-' + c.end)) continue;
    if (!poseUsable(L, c.start) || !poseUsable(L, c.end)) continue;
    const pa = toCanvas(L[c.start], rect), pb = toCanvas(L[c.end], rect);
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  }
  // Faint non-key landmark dots (only usable ones).
  ctx.fillStyle = '#ced4da';
  for (let i = 0; i < L.length; i++) {
    if (POSE_KEY_IDX.includes(i) || !poseUsable(L, i)) continue;
    const p = toCanvas(L[i], rect);
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.5, 2 * dpr), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // 2) shoulder→hip→knee chains + hip angles, by side. Angles are always shown;
  //    low-confidence sides are dashed + flagged ⚠, never hidden.
  const asg = poseSideAssignment(L, rect);
  drawPoseChain(ctx, rect, L, 11, 23, 25, POSE_COL[asg.A], asg.A, dpr);
  drawPoseChain(ctx, rect, L, 12, 24, 26, POSE_COL[asg.B], asg.B, dpr);

  // 3) R/L badge at mid-hip→knee, nudged perpendicular (R left of line, L right).
  for (const ci of [0, 1]) {
    const side = ci === 0 ? asg.A : asg.B;
    const hipIdx = ci === 0 ? 23 : 24, knIdx = ci === 0 ? 25 : 26;
    const H2 = toCanvas(L[hipIdx], rect), K2 = toCanvas(L[knIdx], rect);
    const mx = (H2.x + K2.x) / 2, my = (H2.y + K2.y) / 2;
    const dx = K2.x - H2.x, dy = K2.y - H2.y;
    const len = Math.hypot(dx, dy) || 1;
    // left-of-direction perpendicular: (-dy, dx); right: (dy, -dx)
    const nudge = Math.round(22 * dpr);
    const sign = side === 'R' ? 1 : -1;
    const px = mx + sign * (-dy / len) * nudge;
    const py = my + sign * ( dx / len) * nudge;
    const r = Math.round(9 * dpr);
    ctx.save();
    ctx.lineWidth = Math.max(1.5, 1.5 * dpr);
    ctx.strokeStyle = POSE_COL[side];
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = POSE_COL[side];
    ctx.font = `bold ${Math.round(11 * dpr)}px system-ui`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(side, px, py + 0.5);
    ctx.restore();
  }
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}

function updatePoseReadout() {
  const el = $('ro-pose'); if (!el) return;
  if (!state.poseEnabled) { el.textContent = 'Pose hip (L/R): —'; return; }
  const p = state.poseCurrent;
  if (!p || p.frame !== state.frame) { el.textContent = 'Pose hip (L/R): …'; return; }
  if (!p.landmarks) { el.textContent = 'Pose hip (L/R): no pose detected on this frame'; return; }
  const L = p.landmarks, rect = getVideoRect('primary');
  const asg = poseSideAssignment(L, rect);
  const txt = (sh, hip, kn) => {
    const { arc, confident } = poseChainInfo(L, rect, sh, hip, kn);
    return `${arc.deg.toFixed(1)}°${confident ? '' : ' ⚠low-conf'}`;
  };
  const by = {};
  by[asg.A] = txt(11, 23, 25);
  by[asg.B] = txt(12, 24, 26);
  el.textContent = `Pose hip — L: ${by.L}, R: ${by.R}${p.edited ? ' (edited)' : ''}`;
}

// Current-frame automated hip angles { L, R } as strings (blank if unavailable /
// low-confidence). Used by the XLSX export in place of the old manual Hip tool.
function poseHipAnglesNow() {
  const p = state.poseCurrent;
  if (!state.poseEnabled || !p || !p.landmarks || p.frame !== state.frame) return { L: '', R: '' };
  const L = p.landmarks, rect = getVideoRect('primary');
  const asg = poseSideAssignment(L, rect);
  const byside = {};
  byside[asg.A] = poseChainInfo(L, rect, 11, 23, 25);
  byside[asg.B] = poseChainInfo(L, rect, 12, 24, 26);
  const fmt = info => (info && info.confident) ? info.arc.deg.toFixed(2) : '';
  return { L: fmt(byside.L), R: fmt(byside.R) };
}

// ── Secondary-view rotation angles (F roll, finger) ───────────────────────
// Config drives the toolbar, modes, drawing, dragging, export and persistence
// so each angle is added in one place. state key → its settings.
const SEC_LAYER_CFG = {
  secHorizon: { color: '#ffd43b', label: 'Sec Horizon', p1mode: 'sechor-p1',     p2mode: 'sechor-p2',     type: 'horizon' },
  // ref = which axis the angle is measured FROM: 'vertical' (perp to horizon) for
  // blade roll F; 'horizontal' (right quadrant of the horizon) for the finger.
  secF:       { color: '#20c997', label: 'F',           p1mode: 'secf-p1',       p2mode: 'secf-p2',       type: 'roll', ref: 'vertical'   },
  secFinger:  { color: '#ff922b', label: 'Finger',      p1mode: 'secfinger-p1',  p2mode: 'secfinger-p2',  type: 'roll', ref: 'horizontal' },
};
const SEC_MODES = Object.values(SEC_LAYER_CFG).flatMap(c => [c.p1mode, c.p2mode]);
const SEC_INSTR = {
  'sechor-p1':    'Secondary Horizon — click the FIRST point of the level/horizon line',
  'sechor-p2':    'Secondary Horizon — click the SECOND point of the level/horizon line',
  'secf-p1':      'Angle F (secondary) — click the FIRST point along the f mark',
  'secf-p2':      'Angle F (secondary) — click the SECOND point along the f mark',
  'secfinger-p1': 'Angle Finger (secondary) — click the FIRST point along the finger',
  'secfinger-p2': 'Angle Finger (secondary) — click the SECOND point along the finger',
};

// Secondary horizon RIGHT direction (radians) in secondary pixel space; if no
// horizon is placed, screen-right (0). The vertical reference is this − 90°.
function secHorizonAngle(dims) {
  const H = state.secHorizon;
  if (H?.p1 && H?.p2 && dims) {
    let hx = (H.p2.x - H.p1.x) * dims.w, hy = (H.p2.y - H.p1.y) * dims.h;
    if (hx < 0) { hx = -hx; hy = -hy; }   // orient to point right (right quadrant)
    return Math.atan2(hy, hx);
  }
  return 0;
}
function secVerticalAngle(dims) { return secHorizonAngle(dims) - Math.PI / 2; }

// Reference axis angle (radians) for a layer: 'horizontal' → horizon right,
// 'vertical' → perpendicular (up).
function secRefAngle(dims, ref) {
  return ref === 'horizontal' ? secHorizonAngle(dims) : secVerticalAngle(dims);
}

// Signed acute angle (deg) of a 2-point line from its reference axis. Reduced to
// (−90, 90] (the line is undirected) and sign-flipped so the usual lean is +.
function secLineAngle(p1, p2, dims, ref) {
  if (!p1 || !p2 || !dims) return null;
  const lx = (p2.x - p1.x) * dims.w, ly = (p2.y - p1.y) * dims.h;
  if (lx === 0 && ly === 0) return null;
  const lineAng = Math.atan2(ly, lx);
  const refAng  = secRefAngle(dims, ref);
  let d = lineAng - refAng;
  while (d >   Math.PI / 2) d -= Math.PI;
  while (d <= -Math.PI / 2) d += Math.PI;
  return -(d * 180 / Math.PI);
}

// Draw an extended secondary horizon line (reference for the roll angles).
function drawSecHorizon(ctx, rect, layer, color, overlay) {
  const A = toCanvas(layer.p1, rect);
  if (!layer.p2) { drawDot(ctx, A.x, A.y, color, DOT_R); return; }
  const B = toCanvas(layer.p2, rect);
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 0.8; ctx.setLineDash([8, 4]);
  const ext = extendLine(A, B, overlay.width, overlay.height);
  ctx.beginPath(); ctx.moveTo(ext.x1, ext.y1); ctx.lineTo(ext.x2, ext.y2); ctx.stroke();
  ctx.setLineDash([]);
  drawDot(ctx, A.x, A.y, color, DOT_R);
  drawDot(ctx, B.x, B.y, color, DOT_R);
  drawDot(ctx, (A.x + B.x) / 2, (A.y + B.y) / 2, color, DOT_R);  // midpoint translate handle
  ctx.restore();
}

// Draw one roll-angle layer: solid line, EXTENDED trajectory both ways, a
// half-circle arc from the reference axis to the line, and the degree reported
// on top. `labelSide` (+1 / −1) lifts F's and the finger's labels apart so they
// stay separate even when the two lines are close together.
function drawRollAngle(ctx, rect, layer, color, label, ref, labelSide) {
  if (!layer || !layer.p1) return;
  const dpr = window.devicePixelRatio || 1;
  const P1 = toCanvas(layer.p1, rect);
  ctx.save();
  if (layer.p2) {
    const P2 = toCanvas(layer.p2, rect);
    const M = { x: (P1.x + P2.x) / 2, y: (P1.y + P2.y) / 2 };
    const lineAngC = Math.atan2(P2.y - P1.y, P2.x - P1.x);
    const traj = Math.round(85 * dpr);
    // 1. Extended trajectory (faint dashed, both directions)
    ctx.strokeStyle = color; ctx.globalAlpha = 0.35; ctx.lineWidth = 0.8; ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(M.x - Math.cos(lineAngC) * traj, M.y - Math.sin(lineAngC) * traj);
    ctx.lineTo(M.x + Math.cos(lineAngC) * traj, M.y + Math.sin(lineAngC) * traj); ctx.stroke();
    ctx.globalAlpha = 1; ctx.setLineDash([]);
    // 2. Solid measured segment
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(P1.x, P1.y); ctx.lineTo(P2.x, P2.y); ctx.stroke();
    // 3. Reference axis in canvas space (horizon-right for finger, up for F)
    let horizC = 0;
    if (state.secHorizon?.p1 && state.secHorizon?.p2) {
      const HA = toCanvas(state.secHorizon.p1, rect), HB = toCanvas(state.secHorizon.p2, rect);
      horizC = Math.atan2(HB.y - HA.y, HB.x - HA.x);
      if (Math.cos(horizC) < 0) horizC += Math.PI;          // right quadrant
    }
    const refAngC = ref === 'horizontal' ? horizC : horizC - Math.PI / 2;
    const R = Math.round(30 * dpr);
    // faint reference spoke
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.8; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(M.x, M.y); ctx.lineTo(M.x + Math.cos(refAngC) * (R + 12 * dpr), M.y + Math.sin(refAngC) * (R + 12 * dpr)); ctx.stroke();
    ctx.setLineDash([]);
    // 4. Half-circle arc from reference to the line (orient line within 90° of ref)
    let lAngC = lineAngC, dd = lAngC - refAngC;
    while (dd >   Math.PI / 2) { lAngC -= Math.PI; dd -= Math.PI; }
    while (dd <= -Math.PI / 2) { lAngC += Math.PI; dd += Math.PI; }
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(M.x, M.y, R, Math.min(refAngC, lAngC), Math.max(refAngC, lAngC)); ctx.stroke();
    // 5. Degree reported ON TOP, lifted apart by labelSide so F and finger don't collide
    const deg = secLineAngle(layer.p1, layer.p2, getNativeDims('secondary'), ref);
    if (deg !== null) {
      const mid = (refAngC + lAngC) / 2;
      const lab = { x: M.x + Math.cos(mid) * (R + 16 * dpr), y: M.y + Math.sin(mid) * (R + 16 * dpr) + (labelSide || 0) * 14 * dpr };
      ctx.fillStyle = color; ctx.font = `bold ${Math.round(12 * dpr)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText(`${label}: ${deg >= 0 ? '+' : ''}${deg.toFixed(1)}°`, lab.x, lab.y);
      ctx.textAlign = 'start';
    }
    drawDot(ctx, P2.x, P2.y, color, DOT_R);
  }
  drawDot(ctx, P1.x, P1.y, color, DOT_R);
  ctx.restore();
}

// Whole secondary overlay: horizon + roll layers + selected-point ring + instructions.
function drawSecondaryOverlay(ctx, rect, overlay) {
  const labelSides = { secF: -1, secFinger: 1 };   // lift F up, finger down → separate
  for (const [key, cfg] of Object.entries(SEC_LAYER_CFG)) {
    const inMode = state.mode === cfg.p1mode || state.mode === cfg.p2mode;
    if (state[key]?.p1 && (state.visible[key] || inMode)) {
      if (cfg.type === 'horizon') drawSecHorizon(ctx, rect, state[key], cfg.color, overlay);
      else drawRollAngle(ctx, rect, state[key], cfg.color, cfg.label, cfg.ref, labelSides[key]);
    }
  }
  // Selected fine-tune point ring (only for secondary-panel points)
  if (state.selectedPointId) {
    const sp = getActivePoints().find(p => p.id === state.selectedPointId && p.panel === 'secondary');
    if (sp) {
      const dpr = window.devicePixelRatio || 1;
      const cp = toCanvas(sp.get(), rect);
      ctx.save();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cp.x, cp.y, Math.round(10 * dpr), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(13 * dpr)}px system-ui`;
      ctx.fillText(`▶ ${sp.name}`, cp.x + Math.round(14 * dpr), cp.y - Math.round(10 * dpr));
      ctx.restore();
    }
  }
  if (SEC_INSTR[state.mode]) drawInstruction(ctx, SEC_INSTR[state.mode], overlay.width);
  updateSecReadout();
}

// Bottom-bar readout for the secondary rotation angles (signed tilt from vertical)
function updateSecReadout() {
  const dims = getNativeDims('secondary');
  const fmt = (layer, el, name, ref) => {
    const t = layer?.p2 ? secLineAngle(layer.p1, layer.p2, dims, ref) : null;
    if (el) el.textContent = (t === null || t === undefined)
      ? `${name}: —` : `${name}: ${t >= 0 ? '+' : ''}${t.toFixed(1)}°`;
  };
  fmt(state.secF,      els.roSecF,      'F roll (S)',      SEC_LAYER_CFG.secF.ref);
  fmt(state.secFinger, els.roSecFinger, 'Finger horiz (S)', SEC_LAYER_CFG.secFinger.ref);
}

// Line-line intersection of two rays defined by point + angle
function lineIntersect(p1, a1, p2, a2) {
  const dx1 = Math.cos(a1), dy1 = Math.sin(a1);
  const dx2 = Math.cos(a2), dy2 = Math.sin(a2);
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-9) return null; // parallel
  const t = ((p2.x - p1.x) * dy2 - (p2.y - p1.y) * dx2) / denom;
  return { x: p1.x + dx1 * t, y: p1.y + dy1 * t };
}

function drawDot(ctx, x, y, color, r, label) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  if (label) {
    ctx.fillStyle = color;
    ctx.font = '11px system-ui';
    ctx.fillText(label, x + r + 3, y - r);
  }
  ctx.restore();
}

function drawInstruction(ctx, text, W) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, W, 28);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(text, W / 2, 18);
  ctx.textAlign = 'left';
  ctx.restore();
}

function extendLine(a, b, W, H) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (dx === 0 && dy === 0) return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  // Find t values where line hits canvas boundary
  const ts = [];
  if (dx !== 0) { ts.push(-a.x / dx); ts.push((W - a.x) / dx); }
  if (dy !== 0) { ts.push(-a.y / dy); ts.push((H - a.y) / dy); }
  ts.sort((x, y) => x - y);
  const t0 = ts[0], t1 = ts[ts.length - 1];
  return {
    x1: a.x + dx * t0, y1: a.y + dy * t0,
    x2: a.x + dx * t1, y2: a.y + dy * t1,
  };
}

// ── Readout calculations ──────────────────────────────────────────────
function updateReadout(rect) {
  if (state.scale) {
    const pxPerUnit = state.units === 'in'
      ? state.scale.videoPxPerCm * CM_PER_IN
      : state.scale.videoPxPerCm;
    els.roScale.textContent = `Scale: ${pxPerUnit.toFixed(1)} px/${state.units}`;
  }

  // Derive blade axis from repose (priority) or lfit
  let bladeAngle = null, handleAngle = null, originNorm = null, tipNorm = null;
  const dims = getNativeDims('primary');

  if (state.repose) {
    bladeAngle  = state.repose.angle;
    handleAngle = state.repose.angle; // no separate handle in repose
    originNorm  = state.repose.origin;
    if (state.scale && dims) {
      const bladeVP = state.scale.cm * state.scale.videoPxPerCm;
      tipNorm = {
        x: state.repose.origin.x + Math.cos(bladeAngle) * bladeVP / dims.w,
        y: state.repose.origin.y + Math.sin(bladeAngle) * bladeVP / dims.h,
      };
    }
  } else if (state.lfit && state.template && dims) {
    const tip = getLFitTip();
    if (tip) {
      const { base, angleOffset } = state.lfit;
      const joint = getLFitJoint();           // scale-driven handle endpoint
      const θH = Math.atan2((joint.y - base.y) * dims.h, (joint.x - base.x) * dims.w);
      handleAngle = θH; // base→joint direction for arc a
      bladeAngle = θH + state.template.jointAngle + angleOffset;
      originNorm = joint;
      tipNorm    = tip;
    }
  }

  // ── a: handle (base→joint) ↔ right horizon ──────────────────────────────
  const ha = (state.horizon && state.visible.horizon)
    ? horizonAngleRad(state.horizon.p1, state.horizon.p2, rect) : null;

  if (handleAngle !== null && ha !== null) {
    const degA = handleAngleToHorizonDeg(handleAngle, rect);   // SIGNED
    els.roBladAngle.textContent = `a: handle↔horiz ${degA.toFixed(1)}°`;
  } else if (bladeAngle !== null) {
    els.roBladAngle.textContent = `blade: ${radToDeg(bladeAngle).toFixed(1)}°`;
  } else {
    els.roBladAngle.textContent = 'a: —';
  }

  if (!originNorm) {
    els.roHorizonAngle.textContent = 'c: —';
    els.roEyeAngle.textContent     = 'b: —';
    els.roEyeDist.textContent      = 'finger—base: —';
    return;
  }

  // ── c: eye→joint ↔ left horizon ─────────────────────────────────────────
  if (state.eye && state.visible.eye && ha !== null && dims) {
    const o  = toCanvas(originNorm, rect);
    const ep = toCanvas(state.eye, rect);
    const eyeAngle = Math.atan2(ep.y - o.y, ep.x - o.x);
    const haLeft = Math.cos(ha) >= 0 ? ha + Math.PI : ha;
    els.roHorizonAngle.textContent = `c: eye→joint↔horiz ${angleDiffDeg(eyeAngle, haLeft).toFixed(1)}°`;
  } else {
    els.roHorizonAngle.textContent = 'c: —';
  }

  // ── b: eye—joint distance ────────────────────────────────────────────────
  if (state.eye && state.visible.eye && state.scale && dims) {
    const jointVP = { x: originNorm.x * dims.w, y: originNorm.y * dims.h };
    const eyeVP   = { x: state.eye.x * dims.w, y: state.eye.y * dims.h };
    const bCm = Math.hypot(jointVP.x - eyeVP.x, jointVP.y - eyeVP.y) / state.scale.videoPxPerCm;
    els.roEyeAngle.textContent = `b: eye—joint ${fmtDist(bCm)}`;
  } else {
    els.roEyeAngle.textContent = 'b: —';
  }

  // ── finger—base distance (projected along handle trajectory) ──────────────
  const fp = (state.thumb && state.visible.thumb) ? fingerBaseProjection() : null;
  if (fp) {
    els.roEyeDist.textContent = `finger—base: ${fmtDist(fp.cm)}`;
  } else {
    els.roEyeDist.textContent = 'finger—base: —';
  }
}

function radToDeg(r)        { return (r * 180 / Math.PI + 360) % 360; }
// Horizon angle measured in canvas-pixel space (= video-pixel space under isotropic letterbox)
function horizonAngleRad(p1, p2, rect) {
  const a = toCanvas(p1, rect), b = toCanvas(p2, rect);
  return Math.atan2(b.y - a.y, b.x - a.x);
}
// Pure: convert ANY handle angle (radians, pixel-space atan2 — the same
// convention BladeTracker.detect()/blade-tracker.js "angle" and the manual
// Fit L's θH use) into the reportable "a" degrees relative to the horizon.
// Returns null with no angle or no horizon (blade angle is only meaningful
// against the horizon).
function handleAngleToHorizonDeg(handleAngleRad, rect) {
  if (handleAngleRad == null) return null;
  if (!(state.horizon && state.horizon.p1 && state.horizon.p2)) return null;   // needs horizon
  const ha = horizonAngleRad(state.horizon.p1, state.horizon.p2, rect);
  // SIGNED angle "a" (was folded to a non-negative acute [0,90]). Now that the
  // handle direction (base→joint) is tracked dynamically, keep the SIGN: same
  // acute magnitude as before, but negative when the handle tilts to the other
  // side of the horizon. d = directed handle-vs-horizon in (-180,180]; magnitude
  // = acute angle to the horizon LINE; sign = which side (sign of sin d).
  let d = radToDeg(handleAngleRad) - radToDeg(ha);
  d = ((d % 360) + 540) % 360 - 180;                     // -> (-180, 180]
  const mag = Math.min(Math.abs(d), 180 - Math.abs(d));  // acute [0,90]
  return (Math.sin(d * Math.PI / 180) >= 0 ? 1 : -1) * mag;
}
// The reportable blade angle for the CURRENT frame: handle (base→joint)
// relative to the horizon — the same "a" value shown in the readout. Returns
// null if there's no blade L or no horizon set.
function bladeHorizonAngleDeg(rect) {
  const dims = getNativeDims('primary'); if (!dims) return null;
  let handleAngle = null;
  if (state.repose) handleAngle = state.repose.angle;
  else if (state.lfit && state.template) {
    const joint = getLFitJoint(), base = state.lfit.base;
    if (joint) handleAngle = Math.atan2((joint.y - base.y) * dims.h, (joint.x - base.x) * dims.w);
  }
  return handleAngleToHorizonDeg(handleAngle, rect);
}
function angleDiffDeg(a, b) {
  let d = Math.abs(radToDeg(a) - radToDeg(b));
  if (d > 180) d = 360 - d;
  return d;
}

// ── Loupe / magnifier ─────────────────────────────────────────────────
function updateLoupeIfVisible(panelId) {
  if (!state.loupeVisible[panelId]) return;
  const pos = state.mousePos[panelId];
  if (!pos) return;
  drawLoupe(panelId, pos.x, pos.y);
}

function drawLoupe(panelId, mx, my) {
  try { _drawLoupeInner(panelId, mx, my); } catch(e) { /* guard against SIGTRAP on bad video state */ }
}
function _drawLoupeInner(panelId, mx, my) {
  const vs = state[panelId];
  // The loupe must magnify WHAT IS ON TOP. On primary that is the active
  // checkerboard board when one is selected, otherwise the video/image.
  const board = (panelId === 'primary' && state.checker.which &&
                 state.checker.img && state.checker.img.complete) ? state.checker.img : null;
  if (!vs.ready && !board) return;
  const src = board || (vs.isImage ? vs.imgEl : vs.el);
  const dims = getNativeDims(panelId);
  if (!src || !dims || !dims.w) return;
  // Guard against bad file-descriptor crash on video elements not yet decoded
  // (board images are already fully decoded, so skip the readyState check then)
  if (!board && !vs.isImage && (!vs.el || vs.el.readyState < 2)) return;
  const loupeEl = panelId === 'primary' ? els.loupePrimary : els.loupeSecondary;
  const wrap      = panelId === 'primary' ? els.wrapPrimary   : els.wrapSecondary;

  // mx, my are in physical canvas pixels (after DPR scaling in canvasMousePos)
  const dpr  = window.devicePixelRatio || 1;
  const sz   = LOUPE_RADIUS * 2;         // CSS display size
  const pSz  = Math.round(sz * dpr);     // physical canvas size

  const lctx = loupeEl.getContext('2d');
  lctx.clearRect(0, 0, pSz, pSz);

  // Scale ctx so all drawing below uses CSS-px coordinates (LOUPE_RADIUS, sz)
  lctx.save();
  lctx.scale(dpr, dpr);

  // Clip to circle
  lctx.beginPath();
  lctx.arc(LOUPE_RADIUS, LOUPE_RADIUS, LOUPE_RADIUS, 0, Math.PI * 2);
  lctx.clip();

  const rect    = getVideoRect(panelId);
  const nativeX = ((mx - rect.x) / rect.w) * dims.w;
  const nativeY = ((my - rect.y) / rect.h) * dims.h;

  // 1. Sample native video/image frame — crisp at LOUPE_ZOOM×
  lctx.imageSmoothingEnabled = false;
  lctx.drawImage(src,
    nativeX - LOUPE_SRC_R, nativeY - LOUPE_SRC_R,
    LOUPE_SRC_R * 2, LOUPE_SRC_R * 2,
    0, 0, sz, sz
  );

  // 2. Composite overlay (dots, lines, etc.) at same zoom level
  // The overlay canvas is in physical px; derive the display-px source radius
  const overlayEl  = panelId === 'primary' ? els.overlayPrimary : els.overlaySecondary;
  const dispSrcR   = LOUPE_SRC_R * (rect.w / dims.w);  // physical canvas px
  lctx.imageSmoothingEnabled = false; // keep overlay lines sharp (no blur on upscale)
  lctx.drawImage(overlayEl,
    mx - dispSrcR, my - dispSrcR,
    dispSrcR * 2, dispSrcR * 2,
    0, 0, sz, sz
  );

  // 2b. Redraw key measurement elements at native loupe CSS-px (0.8 px, no upscale blur)
  {
    const lr = {
      x: LOUPE_RADIUS - nativeX * LOUPE_ZOOM,
      y: LOUPE_RADIUS - nativeY * LOUPE_ZOOM,
      w: dims.w * LOUPE_ZOOM,
      h: dims.h * LOUPE_ZOOM,
    };
    const lDot = (n, c) => {
      const p = toCanvas(n, lr);
      lctx.beginPath(); lctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      lctx.fillStyle = c; lctx.fill();
    };
    const lSeg = (n1, n2, c, dash) => {
      const a = toCanvas(n1, lr), b = toCanvas(n2, lr);
      lctx.strokeStyle = c; lctx.lineWidth = 0.8;
      lctx.setLineDash(dash || []); lctx.beginPath();
      lctx.moveTo(a.x, a.y); lctx.lineTo(b.x, b.y); lctx.stroke();
      lctx.setLineDash([]);
    };
    if (state.horizon && state.visible.horizon) {
      const a = toCanvas(state.horizon.p1, lr), b = toCanvas(state.horizon.p2, lr);
      const ext = extendLine(a, b, sz, sz);
      lctx.strokeStyle = '#ffd43b'; lctx.lineWidth = 0.8; lctx.setLineDash([8, 4]);
      lctx.beginPath(); lctx.moveTo(ext.x1, ext.y1); lctx.lineTo(ext.x2, ext.y2);
      lctx.stroke(); lctx.setLineDash([]);
      lDot(state.horizon.p1, '#ffd43b'); lDot(state.horizon.p2, '#ffd43b');
      lDot({ x: (state.horizon.p1.x+state.horizon.p2.x)/2, y: (state.horizon.p1.y+state.horizon.p2.y)/2 }, '#ffd43b');
    }
    if (state.lfit && state.visible.lfit) {
      const tip = getLFitTip();
      if (tip) {
        const jt = getLFitJoint();
        lSeg(state.lfit.base, jt, '#4dabf7');
        lSeg(jt, tip, '#74c0fc', [5, 4]);
        lDot(state.lfit.base, '#4dabf7'); lDot(jt, '#74c0fc'); lDot(tip, '#a5d8ff');
      }
    }
    if (state.eye && state.visible.eye) {
      lDot(state.eye, '#f03e3e');
      const oj = state.lfit?.joint ?? state.repose?.origin;
      if (oj) lSeg(state.eye, oj, 'rgba(240,62,62,0.7)', [4, 4]);
    }
    if (state.thumb && state.visible.thumb) {
      lDot(state.thumb, '#fd7e14');
      const bn = state.lfit?.base ?? state.repose?.origin;
      if (bn) lSeg(state.thumb, bn, 'rgba(253,126,20,0.6)', [4, 4]);
    }
    if (state.scale?.p1 && state.visible.scale) {
      lSeg(state.scale.p1, state.scale.p2, '#4dabf7', [6, 3]);
      lDot(state.scale.p1, '#4dabf7'); lDot(state.scale.p2, '#4dabf7');
    }
  }

  // 3. Crosshair
  lctx.strokeStyle = 'rgba(255,255,255,0.7)';
  lctx.lineWidth = 0.8;
  lctx.beginPath();
  lctx.moveTo(LOUPE_RADIUS, 0); lctx.lineTo(LOUPE_RADIUS, sz);
  lctx.moveTo(0, LOUPE_RADIUS); lctx.lineTo(sz, LOUPE_RADIUS);
  lctx.stroke();

  lctx.restore();

  // Position loupe near cursor — convert physical canvas px → CSS px for positioning
  const wRect  = wrap.getBoundingClientRect();
  const mxCSS  = mx / dpr, myCSS = my / dpr;
  const offset = LOUPE_RADIUS + 20;
  let lx = mxCSS + offset, ly = myCSS - LOUPE_RADIUS;
  if (lx + sz > wRect.width)  lx = mxCSS - offset - sz;
  if (ly < 0)                 ly = 0;
  if (ly + sz > wRect.height) ly = wRect.height - sz;

  loupeEl.style.left = lx + 'px';
  loupeEl.style.top  = ly + 'px';
}

// ── Canvas mouse events ───────────────────────────────────────────────
function canvasMousePos(e, canvas) {
  const r   = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
}

// Redraw overlays on both panels — measurements are shared
function drawBothOverlays() {
  drawOverlay('primary');
  drawOverlay('secondary');
  updatePointPanel();
  // Refresh loupe at last known cursor position so lines/dots update live
  updateLoupeIfVisible('primary');
  updateLoupeIfVisible('secondary');
  scheduleLogWrite();
}

function setupCanvasEvents(panelId) {
  const wrap   = panelId === 'primary' ? els.wrapPrimary   : els.wrapSecondary;
  const canvas = panelId === 'primary' ? els.canvasPrimary : els.canvasSecondary;

  // ── Loupe: both panels ────────────────────────────────────────────────
  wrap.addEventListener('mousemove', e => {
    const pos = canvasMousePos(e, canvas);
    state.mousePos[panelId] = pos;
    if (state.loupeVisible[panelId]) drawLoupe(panelId, pos.x, pos.y);

    if (panelId === 'primary' && state.roiEnabled && state._roiDraw) {
      const nm = toNorm(pos.x, pos.y, getVideoRect('primary'));
      if (!state._roiDraw.dragging) {
        state._roiDraw.end = nm;
      }
      drawOverlay('primary'); return;
    }
    if (panelId === 'primary' && state.bladeRoiEnabled && state._bladeRoiDraw) {
      state._bladeRoiDraw.end = toNorm(pos.x, pos.y, getVideoRect('primary'));
      drawOverlay('primary'); return;
    }

    // Measurement drag is PRIMARY PANEL ONLY — secondary is reference view
    if (panelId !== 'primary' || !state.scratch.dragging) return;

    // Always use the primary panel rect so coords stay in primary space
    const norm = toNorm(pos.x, pos.y, getVideoRect('primary'));

    if (state.scratch.dragTarget === 'repose-origin' && state.repose) {
      state.repose.origin = norm;
      drawBothOverlays();
    } else if (state.scratch.dragTarget === 'repose-rotate' && state.repose) {
      const dims = getNativeDims('primary');
      if (dims) {
        const o = state.repose.origin;
        state.repose.angle = Math.atan2((norm.y - o.y) * dims.h, (norm.x - o.x) * dims.w);
      }
      drawBothOverlays();
    } else if (state.scratch.dragTarget === 'eye' && state.eye) {
      state.eye = norm;
      drawBothOverlays();
    } else if (state.scratch.dragTarget === 'horizon-p1' && state.horizon) {
      state.horizon.p1 = norm;
      drawBothOverlays();
    } else if (state.scratch.dragTarget === 'horizon-p2' && state.horizon) {
      state.horizon.p2 = norm;
      drawBothOverlays();
    } else if (state.scratch.dragTarget === 'horizon-mid' && state.horizon) {
      state.horizon.p1 = { x: norm.x + state.scratch.off1.x, y: norm.y + state.scratch.off1.y };
      state.horizon.p2 = { x: norm.x + state.scratch.off2.x, y: norm.y + state.scratch.off2.y };
      drawBothOverlays();
    } else if (state.scratch.dragTarget === 'scale-p1' && state.scale) {
      state.scale.p1 = norm;
      recalcScale();
      drawBothOverlays();
    } else if (state.scratch.dragTarget === 'scale-p2' && state.scale) {
      state.scale.p2 = norm;
      recalcScale();
      drawBothOverlays();
    } else if (state.scratch.dragTarget === 'lfit-ctrl-scale' && state.lfit) {
      const dx = norm.x - state.scratch.startX;
      const factor = Math.exp(dx * 4) * state.scratch.startVPxPerCm / state.lfit.videoPxPerCm;
      scaleLFit(factor);
      drawBothOverlays();
    } else if (state.scratch.dragTarget === 'lfit-base' && state.lfit) {
      // Rigid translate: base + joint move together
      state.lfit.base  = norm;
      state.lfit.joint = { x: norm.x + state.scratch.jOff.x, y: norm.y + state.scratch.jOff.y };
      drawBothOverlays();
    } else if (state.scratch.dragTarget === 'lfit-joint' && state.lfit) {
      state.lfit.joint = norm;
      // Recalculate videoPxPerCm from new handle length and sync video scale
      const dims = getNativeDims('primary');
      if (dims && state.template) {
        const handleVP = Math.hypot(
          (norm.x - state.lfit.base.x) * dims.w, (norm.y - state.lfit.base.y) * dims.h);
        state.lfit.videoPxPerCm = handleVP / state.template.handleLen;
      }
      drawBothOverlays();
    } else if (state.scratch.dragTarget === 'lfit-rotate' && state.lfit && state.template) {
      const dims = getNativeDims('primary');
      if (dims) {
        const { base, joint } = state.lfit;
        const θH = Math.atan2((joint.y - base.y) * dims.h, (joint.x - base.x) * dims.w);
        const θTarget = Math.atan2((norm.y - joint.y) * dims.h, (norm.x - joint.x) * dims.w);
        state.lfit.angleOffset = θTarget - θH - state.template.jointAngle;
      }
      drawBothOverlays();
    } else if (typeof state.scratch.dragTarget === 'string' && state.scratch.dragTarget.startsWith('pose:') && state.poseCurrent?.landmarks) {
      const idx = +state.scratch.dragTarget.slice(5);
      const lm = state.poseCurrent.landmarks[idx];
      lm.x = norm.x; lm.y = norm.y; lm.visibility = 1;   // user-placed → trusted
      markPoseEdited(); drawBothOverlays();
    } else if (state.scratch.dragTarget === 'activepoint') {
      const _ap = getActivePoints().find(p => p.id === state.scratch.dragPointId);
      if (_ap) { _ap.set(norm); drawBothOverlays(); }
    } else if (state.mode === 'set-scale-draw') {
      state.scratch.p2 = norm;
      drawOverlay(panelId);
    } else if (state.mode === 'horizon-p2') {
      state.scratch.p2 = norm;  // live preview only; state.horizon is set on mouseup
      drawBothOverlays();
    }
  });

  // ── SECONDARY PANEL: rotation-angle placement & drag (self-contained) ──
  if (panelId === 'secondary') {
    const HIT = 0.035;
    const refreshSec = () => { persistSec(); drawOverlay('secondary'); updatePointPanel(); updateStepButtonStates(); updateLoupeIfVisible('secondary'); };

    wrap.addEventListener('mousedown', e => {
      if (!state.secondary.ready) return;
      const pos  = canvasMousePos(e, canvas);
      const norm = toNorm(pos.x, pos.y, getVideoRect('secondary'));

      // Placement modes
      for (const [key, cfg] of Object.entries(SEC_LAYER_CFG)) {
        if (state.mode === cfg.p1mode) {
          pushUndo(); state[key] = { p1: norm, p2: null }; state.visible[key] = true;
          state.mode = cfg.p2mode; refreshSec(); return;
        }
        if (state.mode === cfg.p2mode) {
          if (state[key]) state[key].p2 = norm;
          setMode(null); refreshSec(); return;
        }
      }

      // Drag existing dots / line bodies
      for (const [key] of Object.entries(SEC_LAYER_CFG)) {
        const L = state[key];
        if (!L) continue;
        if (L.p1 && hitDot(norm, L.p1, HIT)) { pushUndo(); state.scratch = { secDrag: `${key}:p1` }; refreshSec(); return; }
        if (L.p2 && hitDot(norm, L.p2, HIT)) { pushUndo(); state.scratch = { secDrag: `${key}:p2` }; refreshSec(); return; }
        const dims = getNativeDims('secondary');
        if (L.p1 && L.p2 && dims && distToSegVP(norm, L.p1, L.p2, dims.w, dims.h) < dims.w * 0.02) {
          pushUndo();
          state.scratch = { secDrag: `${key}:line`, start: norm, o1: { ...L.p1 }, o2: { ...L.p2 } };
          refreshSec(); return;
        }
      }
    });

    wrap.addEventListener('mousemove', e => {
      if (!state.scratch.secDrag) return;
      const pos  = canvasMousePos(e, canvas);
      const norm = toNorm(pos.x, pos.y, getVideoRect('secondary'));
      const [key, part] = state.scratch.secDrag.split(':');
      const L = state[key]; if (!L) return;
      if (part === 'line') {
        const dx = norm.x - state.scratch.start.x, dy = norm.y - state.scratch.start.y;
        L.p1 = { x: state.scratch.o1.x + dx, y: state.scratch.o1.y + dy };
        L.p2 = { x: state.scratch.o2.x + dx, y: state.scratch.o2.y + dy };
      } else {
        L[part] = norm;
      }
      drawOverlay('secondary'); updatePointPanel(); updateLoupeIfVisible('secondary');
    });

    wrap.addEventListener('mouseup', () => { if (state.scratch.secDrag) { state.scratch = {}; persistSec(); } });
    return;  // secondary handled — do not fall into primary placement code
  }

  // ── Measurement placement & drag — PRIMARY PANEL ONLY ─────────────────
  if (panelId !== 'primary') return;

  wrap.addEventListener('mousedown', e => {
    if (!state.primary.ready && !state.checker.which) return;  // allow defining on a board with no video
    const pos  = canvasMousePos(e, canvas);
    const norm = toNorm(pos.x, pos.y, getVideoRect('primary'));

    // ── ROI drawing mode ──────────────────────────────────────────────────
    if (panelId === 'primary' && state.roiEnabled && !state.roi) {
      state._roiDraw = { start: norm, end: null }; drawOverlay('primary');
      return;
    }
    // ── Blade-ROI drawing mode (separate region) ─────────────────────────
    if (panelId === 'primary' && state.bladeRoiEnabled && !state.bladeRoi) {
      state._bladeRoiDraw = { start: norm, end: null }; drawOverlay('primary');
      return;
    }

    // ── Selected chip: generous hit overrides any active tool ──────────────
    if (state.selectedPointId) {
      const _sp = getActivePoints().find(p => p.id === state.selectedPointId && p.panel !== 'secondary');
      if (_sp) {
        const _sPos = _sp.get();
        if (_sPos && hitDot(norm, _sPos, 0.07)) {
          pushUndo();
          state.scratch = { dragging: true, dragTarget: 'activepoint', dragPointId: state.selectedPointId };
          return;
        }
      }
    }

    // ── Active tool clicks ──
    if (state.mode === 'set-scale-draw') {
      state.scratch = { dragging: true, drawing: true, p1: norm, p2: norm };
      drawOverlay('primary');
      return;
    }
    if (state.mode === 'repose-move') {
      pushUndo();
      if (!state.repose) state.repose = { origin: norm, angle: 0 };
      state.repose.origin = norm;
      state.scratch = { dragging: true, dragTarget: 'repose-origin' };
      drawBothOverlays();
      return;
    }
    if (state.mode === 'eye') {
      pushUndo();
      state.eye = norm;
      // Eye tracker: this click both PLACES the marker and captures its offset
      // from the pose right eye; exit placement mode once locked.
      if (state.eyeTrackerEnabled) { onEyeMarkerMoved(); if (!state._eyeArming) setMode(null); }
      drawBothOverlays();
      return;
    }
    if (state.mode === 'thumb') {
      pushUndo();
      state.thumb = norm;
      drawBothOverlays();
      return;
    }
    if (state.mode === 'horizon-p1') {
      pushUndo();
      state.scratch = { dragging: true, drawing: true, p1: norm, p2: norm };
      state.mode = 'horizon-p2';
      drawBothOverlays();
      return;
    }

    // ── Template definition: 2 grid clicks → modal → 3 blade clicks ──
    if (state.mode === 'template-grid-p1') {
      pushUndo();
      state.scratch = { gp1: norm };
      state.mode = 'template-grid-p2';
      drawBothOverlays();
      return;
    }
    if (state.mode === 'template-grid-p2') {
      state.scratch.gp2 = norm;
      els.modalGridScale.classList.remove('hidden');
      drawBothOverlays();
      return;
    }
    if (state.mode === 'template-p1') {
      state.scratch.tp1 = norm;
      state.mode = 'template-p2';
      drawBothOverlays();
      return;
    }
    if (state.mode === 'template-p2') {
      state.scratch.tp2 = norm;
      state.mode = 'template-p3';
      drawBothOverlays();
      return;
    }
    if (state.mode === 'template-p3') {
      const { tp1, tp2, photoPxPerCm } = state.scratch;
      if (tp1 && tp2 && photoPxPerCm) { computeTemplate(tp1, tp2, norm, photoPxPerCm); updateStepButtonStates(); }
      state.scratch = {};
      state.definingTemplate = 1;  // reset routing back to slot 1 after define completes
      setMode(null);
      drawBothOverlays();
      return;
    }

    // ── L-fit: single click places the L at default size; drag/+−/[] to adjust ──
    if (state.mode === 'lfit-p1') {
      if (!state.template) { setMode(null); return; }
      const dims = getNativeDims('primary'); if (!dims) return;
      const rect = getVideoRect('primary');
      // Use existing video scale if set, else default to ~18% canvas width
      const videoPxPerCm = state.scale
        ? state.scale.videoPxPerCm
        : (rect.w * 0.18 / rect.w * dims.w) / state.template.handleLen;
      const handleVPx = state.template.handleLen * videoPxPerCm;
      const joint = { x: norm.x + handleVPx / dims.w, y: norm.y };
      pushUndo();
      state.lfit  = { base: norm, joint, angleOffset: 0, videoPxPerCm };
      updateStepButtonStates();
      setMode(null);
      drawBothOverlays();
      return;
    }

    // ── No active tool: click near dot to drag it ──
    const HIT = 0.035;  // generous hit area (dots are tiny)
    if (state.repose && hitDot(norm, state.repose.origin, HIT)) {
      pushUndo();
      state.scratch = { dragging: true, dragTarget: 'repose-origin' };
    } else if (state.repose && state.scale && getNativeDims('primary') && hitDot(norm, reposesTipNorm(), HIT)) {
      pushUndo();
      state.scratch = { dragging: true, dragTarget: 'repose-rotate' };
    } else if (state.eye && hitDot(norm, state.eye, HIT)) {
      pushUndo();
      state.scratch = { dragging: true, dragTarget: 'eye' };
    } else if (state.horizon) {
      const mid = { x: (state.horizon.p1.x + state.horizon.p2.x) / 2, y: (state.horizon.p1.y + state.horizon.p2.y) / 2 };
      if (hitDot(norm, state.horizon.p1, HIT)) {
        pushUndo();
        state.scratch = { dragging: true, dragTarget: 'horizon-p1' };
      } else if (hitDot(norm, state.horizon.p2, HIT)) {
        pushUndo();
        state.scratch = { dragging: true, dragTarget: 'horizon-p2' };
      } else if (hitDot(norm, mid, HIT)) {
        pushUndo();
        state.scratch = {
          dragging: true, dragTarget: 'horizon-mid',
          off1: { x: state.horizon.p1.x - mid.x, y: state.horizon.p1.y - mid.y },
          off2: { x: state.horizon.p2.x - mid.x, y: state.horizon.p2.y - mid.y },
        };
      }
    } else if (state.scale) {
      if (state.scale.p1 && hitDot(norm, state.scale.p1, HIT)) {
        pushUndo();
        state.scratch = { dragging: true, dragTarget: 'scale-p1' };
      } else if (state.scale.p2 && hitDot(norm, state.scale.p2, HIT)) {
        pushUndo();
        state.scratch = { dragging: true, dragTarget: 'scale-p2' };
      }
    }
    // L-fit drag (Ctrl+any→scale; endpoint dots; line body→translate)
    if (!state.scratch.dragging && state.lfit && state.template) {
      const tip   = getLFitTip();
      const dims  = getNativeDims('primary');
      const joint = getLFitJoint() || state.lfit.joint;   // displayed handle endpoint
      const nearBase  = hitDot(norm, state.lfit.base, HIT);
      const nearJoint = joint && hitDot(norm, joint, HIT);
      // Line-body hit: within ~2% of video width from either segment (tip NOT draggable)
      const lineThr  = dims ? dims.w * 0.025 : 0;
      const onHandle = dims && joint && !nearBase && !nearJoint && distToSegVP(norm, state.lfit.base, joint, dims.w, dims.h) < lineThr;
      const onBlade  = dims && tip && joint && distToSegVP(norm, joint, tip, dims.w, dims.h) < lineThr;

      if (nearBase || nearJoint || onHandle || onBlade) {
        pushUndo();
        if (e.ctrlKey) {
          state.scratch = {
            dragging: true, dragTarget: 'lfit-ctrl-scale',
            startX: norm.x, startVPxPerCm: state.lfit.videoPxPerCm,
          };
        } else {
          // Any touch on L → rigid translate (use [/] and +/- keys for rotation/scale)
          const jOff = {
            x: state.lfit.joint.x - state.lfit.base.x,
            y: state.lfit.joint.y - state.lfit.base.y,
          };
          state.scratch = { dragging: true, dragTarget: 'lfit-base', jOff };
        }
      }
    }
    // Pose key-point drag (shoulder/hip/knee dots); a foot/badge click flips Front L/R.
    if (!state.scratch.dragging && state.poseEnabled && state.poseCurrent?.landmarks && state.poseCurrent.frame === state.frame) {
      const L = state.poseCurrent.landmarks;
      for (const idx of POSE_KEY_IDX) {
        if (hitDot(norm, { x: L[idx].x, y: L[idx].y }, HIT)) { state.scratch = { dragging: true, dragTarget: 'pose:' + idx }; break; }
      }
    }
  });

  wrap.addEventListener('mouseup', () => {
    if (state.roiEnabled && state._roiDraw) {
      if (!state._roiDraw.dragging) {
        const { start, end } = state._roiDraw;
        if (end) {
          const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
          const w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
          if (w > 0.02 && h > 0.02) {
            state.roi = { x, y, w, h };
            state.poseDetCache.clear(); state.poseCurrent = null;
            segScheduleSave();
          }
        }
      } else if (state.roi) {
        segScheduleSave();
      }
      state._roiDraw = null;
      drawOverlay('primary'); return;
    }
    if (state.bladeRoiEnabled && state._bladeRoiDraw) {
      const { start, end } = state._bladeRoiDraw;
      if (end) {
        const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
        if (w > 0.02 && h > 0.02) {
          state.bladeRoi = { x, y, w, h };
          resetBladeTracker();    // new ROI → invalidate cache/smoother
          segScheduleSave();
          scheduleBladeTrack();   // detect immediately if the tracker is on
        }
      }
      state._bladeRoiDraw = null;
      drawOverlay('primary'); return;
    }
    if (state.mode === 'set-scale-draw' && state.scratch.drawing) {
      state.scratch.drawing = false;
      state.scratch.dragging = false;
      state.mode = 'set-scale-done';
      drawBothOverlays();
      els.modalScale.classList.remove('hidden');
      return;
    }
    if (state.mode === 'horizon-p2' && state.scratch.drawing) {
      const { p1, p2 } = state.scratch;
      if (p1 && p2 && Math.hypot(p2.x - p1.x, p2.y - p1.y) > 0.01) {
        state.horizon = { p1, p2 };
        updateStepButtonStates();
      }
      state.scratch = {};
      setMode(null);
      drawBothOverlays();
      return;
    }
    // Multi-click modes accumulate data in scratch across several mousedown events;
    // clearing it on mouseup would destroy data between clicks.
    if ([
      'template-grid-p1', 'template-grid-p2',
      'template-p1', 'template-p2', 'template-p3',
    ].includes(state.mode)) return;
    // #2: a Fit L drag that ended on a frame with computed blade data rewrites
    // that frame's stored blade values (same idea as pose fine-tune). #5: an eye
    // drag while the eye tracker is on re-derives its pose offset + eye stats.
    const _dt = state.scratch.dragTarget;
    if (typeof _dt === 'string' && _dt.indexOf('lfit') === 0) bladeOnFineTune(state.frame);
    if (_dt === 'eye' && state.eyeTrackerEnabled) onEyeMarkerMoved();
    state.scratch = {};
  });
}

function recalcScale() {
  if (!state.scale) return;
  const dims = getNativeDims('primary'); if (!dims) return;
  const { w: vW, h: vH } = dims;
  const dx = (state.scale.p2.x - state.scale.p1.x) * vW;
  const dy = (state.scale.p2.y - state.scale.p1.y) * vH;
  state.scale.videoPxPerCm = Math.hypot(dx, dy) / state.scale.cm;
}

// ── Drag helpers ──────────────────────────────────────────────────────
function hitDot(norm, dotNorm, threshold = 0.02) {
  return Math.hypot(norm.x - dotNorm.x, norm.y - dotNorm.y) < threshold;
}

// Distance (in video pixels) from normalised point pt to segment a→b
function distToSegVP(pt, a, b, vW, vH) {
  const px = (pt.x - a.x) * vW, py = (pt.y - a.y) * vH;
  const dx = (b.x - a.x) * vW, dy = (b.y - a.y) * vH;
  const len2 = dx*dx + dy*dy;
  if (len2 === 0) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px*dx + py*dy) / len2));
  return Math.hypot(px - t*dx, py - t*dy);
}

// Blade tip in normalized [0-1] coords (requires repose + scale + primary dims)
function reposesTipNorm() {
  const dims = getNativeDims('primary'); if (!dims) return { x: 0, y: 0 };
  const { w: vW, h: vH } = dims;
  const bladeVP = state.scale.cm * state.scale.videoPxPerCm;
  return {
    x: state.repose.origin.x + Math.cos(state.repose.angle) * bladeVP / vW,
    y: state.repose.origin.y + Math.sin(state.repose.angle) * bladeVP / vH,
  };
}

// ── L-template helpers ─────────────────────────────────────────────────

// Compute and store template from 3 normalised points using photo's px/cm from grid step
function computeTemplate(p1, p2, p3, photoPxPerCm) {
  const dims = getNativeDims('primary'); if (!dims) return;
  const { w: vW, h: vH } = dims;
  const toPx = n => ({ x: n.x * vW, y: n.y * vH });
  const a = toPx(p1), b = toPx(p2), c = toPx(p3);
  const handleLen = Math.hypot(b.x - a.x, b.y - a.y) / photoPxPerCm;
  const bladeLen  = Math.hypot(c.x - b.x, c.y - b.y) / photoPxPerCm;
  const θH = Math.atan2(b.y - a.y, b.x - a.x);
  const θB = Math.atan2(c.y - b.y, c.x - b.x);
  let jointAngle = θB - θH;
  // Normalise to (-π, π)
  while (jointAngle >  Math.PI) jointAngle -= 2 * Math.PI;
  while (jointAngle < -Math.PI) jointAngle += 2 * Math.PI;
  const slot = state.definingTemplate || 1;
  const obj = { handleLen, bladeLen, jointAngle, p1, p2, p3,
    gp1: state.scratch.gp1, gp2: state.scratch.gp2, gridInches: state.scratch.gridInches };
  state.templates[slot] = obj;
  if (slot === state.activeTemplate) state.template = obj;  // active slot drives Fit L
  persistTemplate(slot);
}

// Returns the raw geometric joint angle from the current template p1/p2/p3,
// called BEFORE the point is moved so we can compute a delta.
function rawJointAngle() {
  const t = state.template;
  if (!t || !t.p1 || !t.p2 || !t.p3) return null;
  const dims = getNativeDims('primary'); if (!dims) return null;
  const { w: vW, h: vH } = dims;
  const a = { x: t.p1.x * vW, y: t.p1.y * vH };
  const b = { x: t.p2.x * vW, y: t.p2.y * vH };
  const c = { x: t.p3.x * vW, y: t.p3.y * vH };
  let ja = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
  while (ja >  Math.PI) ja -= 2 * Math.PI;
  while (ja < -Math.PI) ja += 2 * Math.PI;
  return ja;
}

// Called after fine-tuning p1/p2/p3 so Fit L dimensions stay in sync.
// oldJa is the raw joint angle BEFORE the point moved (from rawJointAngle()).
// Using a delta preserves any flip or angleOffset already in effect.
function recomputeTemplateDimensions(oldJa) {
  const t = state.template;
  if (!t || !t.p1 || !t.p2 || !t.p3 || !t.gp1 || !t.gp2 || !t.gridInches) return;
  const dims = getNativeDims('primary'); if (!dims) return;
  const { w: vW, h: vH } = dims;
  const toPx = n => ({ x: n.x * vW, y: n.y * vH });
  const photoPxPerCm = Math.hypot((t.gp2.x - t.gp1.x) * vW, (t.gp2.y - t.gp1.y) * vH) / (t.gridInches * CM_PER_IN);
  if (photoPxPerCm <= 0) return;
  const a = toPx(t.p1), b = toPx(t.p2), c = toPx(t.p3);
  t.handleLen = Math.hypot(b.x - a.x, b.y - a.y) / photoPxPerCm;
  t.bladeLen  = Math.hypot(c.x - b.x, c.y - b.y) / photoPxPerCm;
  let newJa = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
  while (newJa >  Math.PI) newJa -= 2 * Math.PI;
  while (newJa < -Math.PI) newJa += 2 * Math.PI;
  if (oldJa != null) {
    let delta = newJa - oldJa;
    while (delta >  Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    // When the blade is on the clockwise side of the handle (effective interior
    // angle < 0, which happens when angleOffset ≈ -π after Load Defs), adding
    // +delta would make Fit L tighter instead of wider. Negate the delta in
    // that case so the visual direction always matches Define L.
    let eff = t.jointAngle + (state.lfit?.angleOffset ?? 0);
    while (eff >  Math.PI) eff -= 2 * Math.PI;
    while (eff < -Math.PI) eff += 2 * Math.PI;
    t.jointAngle += (eff < 0 ? -1 : 1) * delta;
  }
}

const TPL_KEY = (slot) => 'omsni-tpl4-' + slot;  // v5 keys: drop stale cache where blade 2 took blade 3's data
function persistTemplate(slot) {
  try { localStorage.setItem(TPL_KEY(slot), JSON.stringify(state.templates[slot])); } catch(e) {}
}

// Flip the ACTIVE template's blade direction (negate joint angle) and bake it in.
// Use this when a blade's reference photo was mirrored, so Fit L bends the right
// way. Persists with the template, so it survives reloads and Save Defs.
function flipActiveTemplate() {
  const t = state.template;
  if (!t || !(t.handleLen > 0)) return;
  t.jointAngle = -t.jointAngle;
  persistTemplate(state.activeTemplate);
  drawBothOverlays();
}

// Rotate whole L around base by moving joint along the handle arc
function rotateLFit(step) {
  if (!state.lfit || !state.template) return;
  const dims = getNativeDims('primary'); if (!dims) return;
  const { base, joint, videoPxPerCm } = state.lfit;
  const handleVP = state.template.handleLen * videoPxPerCm;
  const θH = Math.atan2((joint.y - base.y) * dims.h, (joint.x - base.x) * dims.w);
  const θNew = θH + step;
  state.lfit.joint = {
    x: base.x + Math.cos(θNew) * handleVP / dims.w,
    y: base.y + Math.sin(θNew) * handleVP / dims.h,
  };
}

// Scale the L (change videoPxPerCm + recompute joint) so handle length updates visually
function scaleLFit(factor) {
  if (!state.lfit || !state.template) return;
  const dims = getNativeDims('primary'); if (!dims) return;
  const { base, joint } = state.lfit;
  const newVPxPerCm = state.lfit.videoPxPerCm * factor;
  const handleVP = state.template.handleLen * newVPxPerCm;
  const θH = Math.atan2((joint.y - base.y) * dims.h, (joint.x - base.x) * dims.w);
  state.lfit.joint = {
    x: base.x + Math.cos(θH) * handleVP / dims.w,
    y: base.y + Math.sin(θH) * handleVP / dims.h,
  };
  state.lfit.videoPxPerCm = newVPxPerCm;
}

// Mirror the L horizontally about a vertical line through base (< → >)
function mirrorLFit() {
  if (!state.lfit || !state.template) return;
  const { base, joint, angleOffset } = state.lfit;
  state.lfit.joint = { x: 2 * base.x - joint.x, y: joint.y };
  state.lfit.angleOffset = -2 * state.template.jointAngle - angleOffset;
}

// px/cm that drives Fit L sizing. The Set Scale is authoritative (real-world
// inch reference in the video); only if no scale is set do we fall back to the
// handle-derived value. This is why changing Set Scale resizes the blade, and
// why switching to a blade with a different bladeLen changes the blade length.
function fitVPpcm() {
  if (state.scale && state.scale.videoPxPerCm > 0) return state.scale.videoPxPerCm;
  return state.lfit?.videoPxPerCm || 0;
}

// The DISPLAYED handle endpoint (joint). The stored state.lfit.joint only sets
// the handle DIRECTION; the length is handleLen × Set Scale. So switching to a
// blade with a different handle height changes the handle length, and changing
// Set Scale resizes the whole L — handle and blade together.
function getLFitJoint() {
  if (!state.lfit || !state.template) return state.lfit ? state.lfit.joint : null;
  const dims = getNativeDims('primary'); if (!dims) return state.lfit.joint;
  const { w: vW, h: vH } = dims;
  const { base, joint } = state.lfit;
  let dx = (joint.x - base.x) * vW, dy = (joint.y - base.y) * vH;
  const len = Math.hypot(dx, dy);
  const handleVP = state.template.handleLen * fitVPpcm() * (state.lfit.sizeMul || 1);
  if (len === 0 || handleVP <= 0) return { ...joint };
  return { x: base.x + (dx / len) * handleVP / vW, y: base.y + (dy / len) * handleVP / vH };
}

// Returns the projected tip in normalised coords for the current lfit + angleOffset
function getLFitTip() {
  if (!state.lfit || !state.template) return null;
  const dims = getNativeDims('primary'); if (!dims) return null;
  const { w: vW, h: vH } = dims;
  const base = state.lfit.base;
  const J = getLFitJoint(); if (!J) return null;             // scale-driven handle endpoint
  const θH = Math.atan2((J.y - base.y) * vH, (J.x - base.x) * vW);
  const θB = θH + state.template.jointAngle + state.lfit.angleOffset;
  const bladeVP = state.template.bladeLen * fitVPpcm() * (state.lfit.sizeMul || 1);  // × per-fit +/- multiplier
  return {
    x: J.x + Math.cos(θB) * bladeVP / vW,
    y: J.y + Math.sin(θB) * bladeVP / vH,
  };
}

// Finger-on-handle → base distance, measured ALONG the fit handle trajectory
// (projection onto the base→joint direction). The orange connector is therefore
// parallel to the handle, meeting a hidden perpendicular line through the base.
// Returns { cm, foot } where foot is the normalised point on that perpendicular
// line closest to the finger (the orange line runs finger → foot).
function fingerBaseProjection() {
  if (!state.thumb || !state.lfit?.base || !state.lfit?.joint || !state.scale?.videoPxPerCm) return null;
  const dims = getNativeDims('primary'); if (!dims) return null;
  const { w: vW, h: vH } = dims;
  const base  = { x: state.lfit.base.x * vW,  y: state.lfit.base.y * vH };
  const joint = { x: state.lfit.joint.x * vW, y: state.lfit.joint.y * vH };
  const fing  = { x: state.thumb.x * vW,      y: state.thumb.y * vH };
  let ux = joint.x - base.x, uy = joint.y - base.y;
  const ulen = Math.hypot(ux, uy); if (ulen === 0) return null;
  ux /= ulen; uy /= ulen;                                  // handle-trajectory unit vector
  const proj = (fing.x - base.x) * ux + (fing.y - base.y) * uy; // signed px along handle
  const footPx = { x: fing.x - proj * ux, y: fing.y - proj * uy };
  return {
    cm: Math.abs(proj) / state.scale.videoPxPerCm,
    foot: { x: footPx.x / vW, y: footPx.y / vH },
  };
}

// Draw the in-progress template definition (grid reference dots + blade clicks)
function drawTemplatePreview(ctx, rect) {
  const { gp1, gp2, tp1, tp2 } = state.scratch;
  // Grid reference points (yellow)
  if (gp1) {
    const G1 = toCanvas(gp1, rect);
    drawDot(ctx, G1.x, G1.y, '#ffd43b', DOT_R, 'Grid1');
    if (gp2) {
      const G2 = toCanvas(gp2, rect);
      ctx.save();
      ctx.strokeStyle = '#ffd43b'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(G1.x, G1.y); ctx.lineTo(G2.x, G2.y); ctx.stroke();
      ctx.setLineDash([]); ctx.restore();
      drawDot(ctx, G2.x, G2.y, '#ffd43b', DOT_R, 'Grid2');
    }
  }
  // Blade points (blue)
  if (!tp1) return;
  const A = toCanvas(tp1, rect);
  drawDot(ctx, A.x, A.y, '#74c0fc', DOT_R, 'Base');
  if (tp2) {
    const B = toCanvas(tp2, rect);
    ctx.save();
    ctx.strokeStyle = '#74c0fc'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    ctx.restore();
    drawDot(ctx, B.x, B.y, '#74c0fc', DOT_R, 'Joint');
  }
}

// Draw the stored template result on the reference photo
function drawTemplateRef(ctx, rect) {
  if (!state.template || !state.template.p1) return;
  const { p1, p2, p3, handleLen, bladeLen, gp1, gp2, gridInches } = state.template;

  // Persistent grid reference points with inch label
  if (gp1 && gp2) {
    const G1 = toCanvas(gp1, rect), G2 = toCanvas(gp2, rect);
    ctx.save();
    ctx.strokeStyle = '#ffd43b'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(G1.x, G1.y); ctx.lineTo(G2.x, G2.y); ctx.stroke();
    ctx.setLineDash([]);
    drawDot(ctx, G1.x, G1.y, '#ffd43b', DOT_R, '');
    drawDot(ctx, G2.x, G2.y, '#ffd43b', DOT_R, '');
    if (gridInches) {
      const mid = { x: (G1.x+G2.x)/2, y: (G1.y+G2.y)/2 };
      ctx.fillStyle = '#ffd43b';
      ctx.font = `bold ${Math.round(14 * (window.devicePixelRatio||1))}px system-ui`;
      ctx.fillText(`${gridInches}"`, mid.x + 6, mid.y - 6);
    }
    ctx.restore();
  }

  const A = toCanvas(p1, rect), B = toCanvas(p2, rect), C = toCanvas(p3, rect);
  ctx.save();
  ctx.strokeStyle = '#74c0fc'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  ctx.strokeStyle = '#a5d8ff'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(B.x, B.y); ctx.lineTo(C.x, C.y); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  drawDot(ctx, A.x, A.y, '#74c0fc', DOT_R, '');
  drawDot(ctx, B.x, B.y, '#74c0fc', DOT_R, '');
  drawDot(ctx, C.x, C.y, '#a5d8ff', DOT_R, '');
  ctx.fillStyle = '#74c0fc'; ctx.font = `${Math.round(11 * (window.devicePixelRatio||1))}px system-ui`;
  const midH = { x: (A.x+B.x)/2, y: (A.y+B.y)/2 };
  const midB = { x: (B.x+C.x)/2, y: (B.y+C.y)/2 };
  ctx.fillText(`H: ${fmtDist(handleLen)}`, midH.x + 4, midH.y - 4);
  ctx.fillStyle = '#a5d8ff';
  ctx.fillText(`B: ${fmtDist(bladeLen)}`, midB.x + 4, midB.y - 4);
}

// Draw the fitted L-shape (handle solid, blade dashed)
function drawLFit(ctx, rect) {
  if (!state.lfit || !state.template) return;
  const tip = getLFitTip(); if (!tip) return;
  const base = state.lfit.base;
  const joint = getLFitJoint();              // scale-driven handle endpoint
  const B = toCanvas(base, rect);
  const J = toCanvas(joint, rect);
  const T = toCanvas(tip, rect);

  ctx.save();
  // Handle segment
  ctx.strokeStyle = '#4dabf7'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(B.x, B.y); ctx.lineTo(J.x, J.y); ctx.stroke();
  // Blade segment (projected, dashed)
  ctx.strokeStyle = '#74c0fc'; ctx.lineWidth = 0.8;
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(J.x, J.y); ctx.lineTo(T.x, T.y); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  drawDot(ctx, B.x, B.y, '#4dabf7', DOT_R, '');
  drawDot(ctx, J.x, J.y, '#74c0fc', DOT_R, '');
  drawDot(ctx, T.x, T.y, '#a5d8ff', DOT_R, '');

  // Live blade angle label near joint
  const dims = getNativeDims('primary');
  if (dims) {
    const { w: vW, h: vH } = dims;
    const θH = Math.atan2((joint.y - base.y) * vH, (joint.x - base.x) * vW);
    const θB = θH + state.template.jointAngle + state.lfit.angleOffset;
    // blade angle label at joint commented out (not in readout bar)
    // ctx.fillStyle = '#74c0fc'; ctx.font = 'bold 11px system-ui';
    // ctx.fillText(`${radToDeg(θB).toFixed(2)}°`, J.x + 9, J.y - 9);
  }
}

// ── Tool mode management ──────────────────────────────────────────────
const toolButtons = {
  'set-scale-draw':   $('btn-set-scale'),
  'eye':              $('btn-eye'),
  'thumb':            $('btn-thumb'),
  'horizon-p1':       $('btn-horizon'),
  'template-grid-p1': $('btn-define-template'),
  'template-grid-p2': $('btn-define-template'),
  'template-p1':      $('btn-define-template'),
  'template-p2':      $('btn-define-template'),
  'template-p3':      $('btn-define-template'),
  'lfit-p1':          $('btn-fit-l'),
  'sechor-p1':        $('btn-sec-hor'),
  'sechor-p2':        $('btn-sec-hor'),
  'secf-p1':          $('btn-sec-f'),
  'secf-p2':          $('btn-sec-f'),
  'secfinger-p1':     $('btn-sec-finger'),
  'secfinger-p2':     $('btn-sec-finger'),
};

function setMode(mode) {
  state.mode = mode;
  state.scratch = {};
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  if (mode && toolButtons[mode]) toolButtons[mode].classList.add('active');
  // Template define flow can target slot 2 — highlight the matching button
  if (mode && mode.startsWith('template-') && state.definingTemplate >= 2) {
    $('btn-define-template').classList.remove('active');
    const tb = $('btn-define-template-' + state.definingTemplate);
    if (tb) tb.classList.add('active');
  }

  // Update cursor to indicate active tool
  const wrap1 = els.wrapPrimary, wrap2 = els.wrapSecondary;
  const cursors = {
    'set-scale-draw':   'crosshair',
    'set-scale-done':   'default',
    'repose-move':      'move',
    'repose-rotate':    'alias',
    'eye':              'crosshair',
    'thumb':            'crosshair',
    'horizon-p1':       'crosshair',
    'horizon-p2':       'crosshair',
    'template-grid-p1': 'crosshair',
    'template-grid-p2': 'crosshair',
    'template-p1':      'crosshair',
    'template-p2':      'crosshair',
    'template-p3':      'crosshair',
    'lfit-p1':          'crosshair',
    'sechor-p1':        'crosshair',
    'sechor-p2':        'crosshair',
    'secf-p1':          'crosshair',
    'secf-p2':          'crosshair',
    'secfinger-p1':     'crosshair',
    'secfinger-p2':     'crosshair',
  };
  const cur = cursors[mode] || 'crosshair';
  wrap1.style.cursor = cur;
  wrap2.style.cursor = cur;
  updateStepButtonStates();
}

// Sets .layer-set / .layer-hidden classes on step buttons to reflect placed+visibility state
function updateStepButtonStates() {
  const pairs = [
    ['btn-set-scale',       'scale'],
    ['btn-eye',             'eye'],
    ['btn-thumb',           'thumb'],
    ['btn-horizon',         'horizon'],
    ['btn-fit-l',           'lfit'],
    ['btn-sec-hor',         'secHorizon'],
    ['btn-sec-f',           'secF'],
    ['btn-sec-finger',      'secFinger'],
  ];
  for (const [id, key] of pairs) {
    const btn = $(id);
    if (!btn) continue;                          // finger button may not exist yet
    const set = !!state[key];
    btn.classList.toggle('layer-set',    set &&  state.visible[key]);
    btn.classList.toggle('layer-hidden', set && !state.visible[key]);
  }
  // Define L buttons stay fully available (never dimmed) — only a green "defined"
  // tint. Their template ref is hidden on video by design, but the buttons must
  // always be clickable to re-adjust the L, so they never get layer-hidden.
  // Green only when the blade was actually defined by clicks (has p1) AND its L
  // is currently visible — so at startup nothing looks selected.
  const b1 = $('btn-define-template');
  if (b1) { b1.classList.toggle('layer-set', !!state.templates[1]?.p1 && state.visible.template && state.activeTemplate === 1); b1.classList.remove('layer-hidden'); }
  const b2 = $('btn-define-template-2');
  if (b2) { b2.classList.toggle('layer-set', !!state.templates[2]?.p1 && state.visible.template && state.activeTemplate === 2); b2.classList.remove('layer-hidden'); }
  const b3 = $('btn-define-template-3');
  if (b3) { b3.classList.toggle('layer-set', !!state.templates[3]?.p1 && state.visible.template && state.activeTemplate === 3); b3.classList.remove('layer-hidden'); }
  const b4 = $('btn-define-template-4');
  if (b4) { b4.classList.toggle('layer-set', !!state.templates[4]?.p1 && state.visible.template && state.activeTemplate === 4); b4.classList.remove('layer-hidden'); }
  // Blade toggle shows the active blade in its label; don't special-case blade 2.
  const bt = $('btn-blade-toggle');
  if (bt) bt.classList.remove('active');
  // Checkerboard source tabs reflect which of the four is currently shown
  for (const [id, which] of [['btn-board-video',null],['btn-board-1','L1'],['btn-board-2','L2'],['btn-board-3','L3'],['btn-board-c','custom']]) {
    const b = $(id);
    if (b) b.classList.toggle('active', state.checker.which === which);
  }
  // ── Collapsed blade-template UI (COSMETIC ONLY) ──────────────────────────
  // Every Define-L/board button stays in the DOM with its handler intact; we
  // just SHOW the one that matches the active blade toggle (1/2/3) and hide the
  // others — "one Define L, switch it with the Blade toggle". No logic changed.
  for (const n of [1, 2, 3]) {
    const shown = state.activeTemplate === n ? '' : 'none';
    const d = $(n === 1 ? 'btn-define-template' : 'btn-define-template-' + n);
    if (d) d.style.display = shown;
    const bd = $('btn-board-' + n);
    if (bd) bd.style.display = shown;
  }
  // Custom (C): visible when C is active OR not yet defined — so an undefined
  // custom blade stays reachable to DEFINE (setActiveTemplate refuses to switch
  // to an undefined slot). Once defined it collapses too: reach it via toggle→C.
  const cDefined = !!(state.templates[4] && state.templates[4].p1);
  const showC = state.activeTemplate === 4 || !cDefined ? '' : 'none';
  for (const id of ['btn-define-template-4', 'clear-template-4', 'btn-board-c', 'clear-board-c']) {
    const e = $(id); if (e) e.style.display = showC;
  }
}

// ── Undo ──────────────────────────────────────────────────────────────
function pushUndo() {
  state.undoStack.push(JSON.stringify({
    scale: state.scale, repose: state.repose,
    eye: state.eye, horizon: state.horizon, thumb: state.thumb,
    template: state.template, lfit: state.lfit, hip: state.hip,
    secF: state.secF, secFinger: state.secFinger, secHorizon: state.secHorizon,
  }));
  if (state.undoStack.length > 50) state.undoStack.shift();
}

function undo() {
  if (!state.undoStack.length) return;
  const prev = JSON.parse(state.undoStack.pop());
  state.scale    = prev.scale;
  state.repose   = prev.repose;
  state.eye      = prev.eye;
  state.horizon  = prev.horizon;
  state.thumb    = prev.thumb ?? null;
  state.template = prev.template;
  state.templates[state.activeTemplate] = prev.template;  // keep active slot in sync
  state.lfit     = prev.lfit;
  state.hip      = prev.hip ?? null;
  state.secF      = prev.secF ?? null;
  state.secFinger = prev.secFinger ?? null;
  state.secHorizon = prev.secHorizon ?? null;
  updateStepButtonStates();
  drawOverlay('primary');
  drawOverlay('secondary');
}

// ── Export ────────────────────────────────────────────────────────────
function openExcelModal() {
  els.inputXlSubj.value  = localStorage.getItem('omsni-xl-subj')  || '1';
  els.inputXlPhase.value = localStorage.getItem('omsni-xl-phase') || '1';
  els.inputXlTrial.value = localStorage.getItem('omsni-xl-trial') || '1';
  const foot = localStorage.getItem('omsni-xl-foot') || 'Right';
  const footBtn = document.getElementById('xl-foot-toggle');
  if (footBtn) footBtn.textContent = foot;
  const eyeBtn = document.getElementById('xl-eye-toggle');
  if (eyeBtn) eyeBtn.textContent = getFrontEye();
  const dryBtn = document.getElementById('xl-dryrun-toggle');
  if (dryBtn) { dryBtn.textContent = 'No'; dryBtn.style.background = '#25252b'; dryBtn.style.borderColor = '#555'; dryBtn.style.color = '#e8e8ea'; }
  const unitsBtn = document.getElementById('xl-units-toggle');
  if (unitsBtn) unitsBtn.textContent = localStorage.getItem('omsni-xl-units') || state.units;
  const bladeEl = document.getElementById('xl-blade-type');
  if (bladeEl) bladeEl.textContent = state.activeTemplate === 4 ? 'Blade C' : `Blade ${state.activeTemplate}`;
  _syncGripUI();
  setInitials(getInitials());
  const savedPath = localStorage.getItem('omsni-xl-path');
  const pathEl = document.getElementById('xl-path-display');
  if (pathEl) pathEl.textContent = savedPath ? `File: ${savedPath}` : 'No file chosen — will prompt on first export';
  els.modalExportXl.classList.remove('hidden');
  els.inputXlSubj.focus();
}

async function doExportExcel() {
  const subj  = parseInt(els.inputXlSubj.value)  || 1;
  const phase = parseInt(els.inputXlPhase.value) || 1;
  const trial = parseInt(els.inputXlTrial.value) || 1;
  els.modalExportXl.classList.add('hidden');

  const rect = getVideoRect('primary');
  const dims = getNativeDims('primary');

  // Export units (cm/in) chosen in the dialog; convert cm → chosen unit here
  const xlUnits = localStorage.getItem('omsni-xl-units') || state.units;
  const toXlUnit = (cm) => (xlUnits === 'in' ? cm / CM_PER_IN : cm);

  let angleA = '', bVal = '', cVal = '', fingerBase = '', hipL = '', hipR = '';

  if (rect && dims) {
    const { w: vW, h: vH } = dims;
    const ha = (state.horizon && state.visible.horizon)
      ? horizonAngleRad(state.horizon.p1, state.horizon.p2, rect) : null;
    const originNorm = state.lfit ? (getLFitJoint() ?? state.lfit.joint ?? null) : null;
    const o = originNorm ? toCanvas(originNorm, rect) : null;

    if (state.lfit?.base && originNorm) {
      const base = state.lfit.base;
      const handleAngle = Math.atan2((originNorm.y - base.y) * vH, (originNorm.x - base.x) * vW);
      if (ha !== null) {
        const _a = handleAngleToHorizonDeg(handleAngle, rect);   // SIGNED (see helper)
        if (_a != null) angleA = _a.toFixed(2);
      }
    }

    if (state.eye && state.visible.eye && originNorm && state.scale?.videoPxPerCm) {
      const jointVP = { x: originNorm.x * vW, y: originNorm.y * vH };
      const eyeVP   = { x: state.eye.x * vW,  y: state.eye.y * vH };
      bVal = toXlUnit(Math.hypot(jointVP.x - eyeVP.x, jointVP.y - eyeVP.y) / state.scale.videoPxPerCm).toFixed(3);
    }

    if (state.eye && state.visible.eye && o && ha !== null) {
      const ep = toCanvas(state.eye, rect);
      const haLeft = Math.cos(ha) >= 0 ? ha + Math.PI : ha;
      cVal = angleDiffDeg(Math.atan2(ep.y - o.y, ep.x - o.x), haLeft).toFixed(2);
    }

    const fp = fingerBaseProjection();
    if (fp) fingerBase = toXlUnit(fp.cm).toFixed(3);
  }

  // Hip angles now come from the automated pose (L / R), not the old manual tool.
  const ph = poseHipAnglesNow();
  hipL = ph.L; hipR = ph.R;

  const fps = state.primary.fps || 30;
  const f   = state.frame;
  const tot = Math.max((state.primary.totalFrames || 1) - 1, 0);
  const t   = f / fps;
  const mm  = Math.floor(t / 60);
  const ss  = Math.floor(t) % 60;
  const ms  = Math.floor((t % 1) * 1000);
  const timeStr = `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;

  const frontFoot = localStorage.getItem('omsni-xl-foot') || 'Right';
  const bladeType = state.activeTemplate === 4 ? 'Blade C' : `Blade ${state.activeTemplate}`;

  // Ensure segments are sorted before checking / exporting
  sortSegments();
  // Selected-segment stats + out-of-segment warning
  const seg = state.segments?.[state.currentSegment];
  if (seg && seg.start != null && seg.end != null && (f < seg.start || f > seg.end)) {
    const _ep = exportFramePos(f); const _epStr = _ep ? ` (this is export frame #${_ep} in sorted order)` : '';
    if (!confirm(`This frame is not inside the selected Segment.${_epStr}\nWanna continue?`)) return;
  }
  const sL = seg?.stats?.L, sR = seg?.stats?.R;
  const _sf = v => (v != null ? (+v).toFixed(2) : '');
  const hipL_min = _sf(sL?.min), hipL_max = _sf(sL?.max), hipL_rom = _sf(sL?.rom), hipL_mean = _sf(sL?.mean), hipL_median = _sf(sL?.median);
  const hipR_min = _sf(sR?.min), hipR_max = _sf(sR?.max), hipR_rom = _sf(sR?.rom), hipR_mean = _sf(sR?.mean), hipR_median = _sf(sR?.median);
  let durationStr = '';
  if (seg?.start != null && seg?.end != null) {
    const ds = (seg.end - seg.start + 1) / fps;
    const dm = Math.floor(ds / 60), dss = Math.floor(ds) % 60, dms = Math.floor((ds % 1) * 1000);
    durationStr = `${String(dm).padStart(2,'0')}:${String(dss).padStart(2,'0')}.${String(dms).padStart(3,'0')}`;
  }

  // Blade subsegment stats (additive columns — blank when no blade Compute has run).
  const bs = seg?.bladeStats;
  const blade_min = bs?.n ? _sf(bs.min) : '', blade_max = bs?.n ? _sf(bs.max) : '';
  const blade_rom = bs?.n ? _sf(bs.rom) : '', blade_mean = bs?.n ? _sf(bs.mean) : '';
  const blade_median = bs?.n ? _sf(bs.median) : '';
  const blade_dispCm  = bs?.dispCm != null ? toXlUnit(bs.dispCm).toFixed(3) : '';
  const blade_subRange = (bs?.subStart != null) ? `${bs.subStart}-${bs.subEnd}` : '';
  // Blade subsegment DURATION — inclusive frame count / fps, same mm:ss.ms logic
  // as the pose segment "Duration" above (durationStr). Blank when no subsegment.
  let blade_subDur = '';
  if (bs?.subStart != null && bs?.subEnd != null) {
    let ba = bs.subStart, bb = bs.subEnd; if (ba > bb) [ba, bb] = [bb, ba];
    const bds = (bb - ba + 1) / fps;
    const bdm = Math.floor(bds / 60), bdss = Math.floor(bds) % 60, bdms = Math.floor((bds % 1) * 1000);
    blade_subDur = `${String(bdm).padStart(2,'0')}:${String(bdss).padStart(2,'0')}.${String(bdms).padStart(3,'0')}`;
  }
  // Eye subsegment stats (blank if the eye tracker never ran). c-angle in °,
  // distance in the chosen unit. Mean/median live here (not in the segment bar).
  const eC = bs?.eye?.c, eD = bs?.eye?.dist;
  const eye_c_min = eC?.n ? _sf(eC.min) : '', eye_c_max = eC?.n ? _sf(eC.max) : '';
  const eye_c_mean = eC?.n ? _sf(eC.mean) : '', eye_c_median = eC?.n ? _sf(eC.median) : '';
  const eye_d_min = eD?.n ? toXlUnit(eD.min).toFixed(3) : '', eye_d_max = eD?.n ? toXlUnit(eD.max).toFixed(3) : '';
  const eye_d_mean = eD?.n ? toXlUnit(eD.mean).toFixed(3) : '', eye_d_median = eD?.n ? toXlUnit(eD.median).toFixed(3) : '';

  // Secondary-view rotation angles (F from vertical, Finger from horizon-right)
  const sdims = getNativeDims('secondary');
  const tF  = state.secF?.p2      ? secLineAngle(state.secF.p1,      state.secF.p2,      sdims, SEC_LAYER_CFG.secF.ref)      : null;
  const tFi = state.secFinger?.p2 ? secLineAngle(state.secFinger.p1, state.secFinger.p2, sdims, SEC_LAYER_CFG.secFinger.ref) : null;
  const fRoll      = tF  !== null && tF  !== undefined ? tF.toFixed(2)  : '';
  const fingerRoll = tFi !== null && tFi !== undefined ? tFi.toFixed(2) : '';

  const headers = [
    'Phase.Trial',
    'Handle to Horizon (a) °',
    `b: Eye-Joint (${xlUnits})`,
    'c: Eye-Horizon °',
    `Finger to Base (${xlUnits})`,
    'Hip Left °',
    'Hip Right °',
    'Blade F roll °',
    'Finger roll °',
    'HipL_min', 'HipL_max', 'HipL_ROM', 'HipL_mean', 'HipL_median',
    'HipR_min', 'HipR_max', 'HipR_ROM', 'HipR_mean', 'HipR_median',
    'Duration',
    'Front Foot',
    'Front Eye',
    'Blade Type',
    'Grip Style',
    'Frame of exported measures',
    'Start Frame',
    'End Frame',
    'Time mm:ss.ms',
    'Dry Run',
    'Initials',
    'Blade_min °', 'Blade_max °', 'Blade_ROM °', 'Blade_mean °', 'Blade_median °',
    `Blade_JointDisplacement (${xlUnits})`,
    'Blade Subsegment Range',
    'Blade Subsegment Duration',
    'Eye_c_min °', 'Eye_c_max °', 'Eye_c_mean °', 'Eye_c_median °',
    `Eye_dist_min (${xlUnits})`, `Eye_dist_max (${xlUnits})`, `Eye_dist_mean (${xlUnits})`, `Eye_dist_median (${xlUnits})`,
  ];

  // Warn if primary measurement columns are empty (related points not yet defined)
  const _missingCols = [
    { v: angleA,     n: 'Handle to Horizon (a) °' },
    { v: bVal,       n: `b: Eye-Joint (${xlUnits})` },
    { v: cVal,       n: 'c: Eye-Horizon °' },
    { v: fingerBase, n: `Finger to Base (${xlUnits})` },
    { v: hipL,       n: 'Hip Left °' },
    { v: hipR,       n: 'Hip Right °' },
    { v: fRoll,      n: 'Blade F roll °' },
    { v: fingerRoll, n: 'Finger roll °' },
  ].filter(c => c.v === '').map(c => c.n);
  if (_missingCols.length > 0) {
    const msg = `These columns are missing because the related points are not defined yet:\n\n• ${_missingCols.join('\n• ')}\n\nProceed anyway?`;
    if (!confirm(msg)) return;
  }

  const startFrameStr = (seg?.start != null) ? `${seg.start}/${tot}` : '';
  const endFrameStr   = (seg?.end   != null) ? `${seg.end}/${tot}`   : '';
  const dryRun = ($('xl-dryrun-toggle')?.textContent === 'Yes') ? 'Yes' : 'No';
  const row = [
    `${phase}.${trial}`, angleA, bVal, cVal, fingerBase, hipL, hipR,
    fRoll, fingerRoll,
    hipL_min, hipL_max, hipL_rom, hipL_mean, hipL_median,
    hipR_min, hipR_max, hipR_rom, hipR_mean, hipR_median,
    durationStr, frontFoot, getFrontEye(), bladeType, getGripLabel(),
    `${f}/${tot}`, startFrameStr, endFrameStr, timeStr, dryRun, getInitials(),
    blade_min, blade_max, blade_rom, blade_mean, blade_median,
    blade_dispCm, blade_subRange, blade_subDur,
    eye_c_min, eye_c_max, eye_c_mean, eye_c_median,
    eye_d_min, eye_d_max, eye_d_mean, eye_d_median,
  ];

  localStorage.setItem('omsni-xl-subj',  String(subj));
  localStorage.setItem('omsni-xl-phase', String(phase));
  localStorage.setItem('omsni-xl-trial', String(trial));

  let xlPath = localStorage.getItem('omsni-xl-path');
  if (!xlPath) {
    xlPath = await window.api.pickXlsxPath('measurements.xlsx');
    if (!xlPath) return;
    localStorage.setItem('omsni-xl-path', xlPath);
    const pathEl = document.getElementById('xl-path-display');
    if (pathEl) pathEl.textContent = `File: ${xlPath}`;
  }

  const sheetName = `Subj ${subj}`;
  let res = await window.api.saveExcel({ xlsxPath: xlPath, sheetName, headers, row });
  if (!res) return;
  if (res.duplicate) {
    const ok = confirm(`"${sheetName}" already has a row for Phase.Trial ${phase}.${trial} (Dry Run = ${dryRun}).\n\nAdd another row anyway?\n\n(Cancel to go back and change the Phase/Trial.)`);
    if (!ok) { openExcelModal(); return; }
    res = await window.api.saveExcel({ xlsxPath: xlPath, sheetName, headers, row, force: true });
  }
  if (res.ok) {
    // success — snapshot visuals for this frame so jumping back restores them
    state.exportDefs[state.frame] = snapshotState();
    if (typeof addExportMark === 'function') addExportMark(state.frame);
    // addExportMark calls segScheduleSave which persists exportDefs into the seg file
  } else if (res.error) {
    alert('Excel export failed: ' + res.error);
  }
}

async function exportMeasurements() {
  const rows = [
    ['Frame', 'View', 'Measurement', 'Value', 'Unit'],
  ];
  const f = state.frame;

  if (state.scale) {
    rows.push([f, 'primary', 'Scale (px/cm internal)', state.scale.videoPxPerCm.toFixed(4), 'px/cm']);
    rows.push([f, 'primary', 'Blade length', fromCm(state.scale.cm).toFixed(3), state.units]);
  }
  if (state.repose) {
    rows.push([f, 'primary', 'Blade angle', radToDeg(state.repose.angle).toFixed(2), 'deg']);
  }
  if (state.repose && state.horizon) {
    const rect = getVideoRect('primary');
    const ha = horizonAngleRad(state.horizon.p1, state.horizon.p2, rect);
    rows.push([f, 'primary', 'Blade vs horizon', angleDiffDeg(state.repose.angle, ha).toFixed(2), 'deg']);
  }
  if (state.eye && state.repose && state.scale) {
    const d = getNativeDims('primary'); if (!d) return;
    const { w: vW, h: vH } = d;
    const bladeVP = state.scale.cm * state.scale.videoPxPerCm;
    const { angle } = state.repose;
    const tipVP = {
      x: state.repose.origin.x * vW + Math.cos(angle) * bladeVP,
      y: state.repose.origin.y * vH + Math.sin(angle) * bladeVP,
    };
    const eyeVP = { x: state.eye.x * vW, y: state.eye.y * vH };
    const distCm = Math.hypot(tipVP.x - eyeVP.x, tipVP.y - eyeVP.y) / state.scale.videoPxPerCm;
    rows.push([f, 'primary', 'Eye-tip distance', fromCm(distCm).toFixed(3), state.units]);
  }

  const csv = rows.map(r => r.join(',')).join('\n');
  const saved = await window.api.saveExport({ csv, filename: `frame${f}.csv` });
  void saved;
}

// ── Keyboard shortcuts ────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  // Skip text/number inputs but intercept arrows from range sliders
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;

  const TMPL_MODES = ['template-grid-p1','template-grid-p2','template-p1','template-p2','template-p3'];

  // Arrow keys: move selected point OR navigate frames
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    if (state.selectedPointId) {
      e.preventDefault();
      const pts = getActivePoints();
      const pt = pts.find(p => p.id === state.selectedPointId);
      if (pt) {
        const panel = pt.panel || 'primary';      // secondary points step in secondary space
        const dims = getNativeDims(panel);
        const step = dims ? (e.shiftKey ? 1 / dims.w : 0.25 / dims.w) : 0.0005;
        const cur = pt.get();
        if (e.key === 'ArrowRight') pt.set({ x: cur.x + step, y: cur.y });
        if (e.key === 'ArrowLeft')  pt.set({ x: cur.x - step, y: cur.y });
        if (e.key === 'ArrowDown')  pt.set({ x: cur.x, y: cur.y + step });
        if (e.key === 'ArrowUp')    pt.set({ x: cur.x, y: cur.y - step });
        if (panel === 'secondary') persistSec();
        drawBothOverlays();
        updatePointPanel();
        // Show loupe centred on the moved point (on its own panel)
        if (state.loupeVisible[panel]) {
          const newPos = pt.get();
          const cp = toCanvas(newPos, getVideoRect(panel));
          drawLoupe(panel, cp.x, cp.y);
        }
      }
      return;
    }
    if (e.key === 'ArrowRight') { e.preventDefault(); goToFrame(state.frame + 1); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); goToFrame(state.frame - 1); }
    return;
  }

  if (e.key === '[' || e.key === ']') {
    e.preventDefault();
    const dir = e.key === ']' ? 1 : -1;
    // Very fine step in Define L photo step (sub-degree precision)
    if (state.mode === 'template-p3' && state.scratch.tp1 && state.scratch.tp2) {
      const tStep = (e.shiftKey ? STEP_FINE / 8 : STEP_FINE / 2) * dir;
      const dims = getNativeDims('primary');
      if (dims) {
        const { tp1, tp2 } = state.scratch;
        const dx = (tp2.x - tp1.x) * dims.w, dy = (tp2.y - tp1.y) * dims.h;
        const len = Math.hypot(dx, dy);
        const θ = Math.atan2(dy, dx) + tStep;
        state.scratch.tp2 = { x: tp1.x + Math.cos(θ)*len/dims.w, y: tp1.y + Math.sin(θ)*len/dims.h };
      }
    }
    if (state.repose || state.lfit) {
      const step = (e.shiftKey ? STEP_FINE : STEP_COARSE) * dir;
      pushUndo();
      if (state.repose) state.repose.angle += step;
      if (state.lfit) rotateLFit(step);
    }
    drawBothOverlays();
  }

  // +/= or - : fine-tune the Fit L SIZE — both lines (handle + blade) grow (+) or
  // shrink (−) gradually via a per-fit multiplier. The Set Scale is NOT changed.
  if ((e.key === '=' || e.key === '+' || e.key === '-') && state.lfit) {
    e.preventDefault();
    const pct = e.shiftKey ? 1.005 : 1.02;
    const factor = (e.key === '-') ? 1 / pct : pct;   // '+' → bigger
    pushUndo();
    state.lfit.sizeMul = (state.lfit.sizeMul || 1) * factor;
    drawBothOverlays();
  }

  if (e.key === 'z' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); undo(); }

  if (e.key === 'u') {
    e.preventDefault();
    if (TMPL_MODES.includes(state.mode)) {
      const m = state.mode, s = state.scratch;
      // Preserve grid context across setMode(null) which clears scratch
      const base = { gp1: s.gp1, gp2: s.gp2, gridInches: s.gridInches, photoPxPerCm: s.photoPxPerCm };
      if (m === 'template-p3') {
        const tp1 = s.tp1;
        setMode(null);
        state.scratch = { ...base, tp1 };
        state.mode = 'template-p2';
        $('btn-define-template').classList.add('active');
      } else if (m === 'template-p2') {
        setMode(null);
        state.scratch = { ...base };
        state.mode = 'template-p1';
        $('btn-define-template').classList.add('active');
      } else {
        setMode(null);
      }
      drawBothOverlays();
    } else {
      undo();
    }
  }

  if ((e.key === 'f' || e.key === 'F') && state.lfit) {
    pushUndo(); mirrorLFit(); drawBothOverlays();
  }

  // a / d → skip 10 frames backward / forward
  if (e.key === 'a' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); goToFrame(state.frame - 10); }
  if (e.key === 'd' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); goToFrame(state.frame + 10); }

  // s → flip Pose Front L/R (when Pose is on)
  // if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey && state.poseEnabled) {
  //   e.preventDefault();
  //   togglePoseFront();
  // }

  if (e.key === 'Escape') {
    state.selectedPointId = null;
    updatePointPanel();
    setMode(null);
    els.modalScale.classList.add('hidden');
    els.modalGridScale.classList.add('hidden');
  }
});

// ── Slider events ─────────────────────────────────────────────────────
els.sliderPrimary.addEventListener('input', e => goToFrame(parseInt(e.target.value, 10)));
els.sliderSecondary.addEventListener('input', e => goToFrame(parseInt(e.target.value, 10)));

// ── Button wiring ─────────────────────────────────────────────────────
$('btn-load-primary').addEventListener('click', () => loadVideo('primary'));
$('btn-load-secondary').addEventListener('click', () => loadVideo('secondary'));

$('btn-mag-primary').addEventListener('click', () => {
  state.loupeVisible.primary = !state.loupeVisible.primary;
  $('btn-mag-primary').classList.toggle('active', state.loupeVisible.primary);
  els.loupePrimary.classList.toggle('hidden', !state.loupeVisible.primary);
});
$('btn-mag-secondary').addEventListener('click', () => {
  state.loupeVisible.secondary = !state.loupeVisible.secondary;
  $('btn-mag-secondary').classList.toggle('active', state.loupeVisible.secondary);
  els.loupeSecondary.classList.toggle('hidden', !state.loupeVisible.secondary);
});

// Step buttons: if layer already placed → toggle visibility; if not → enter placement mode
$('btn-set-scale').addEventListener('click', () => {
  if (state.scale) { state.visible.scale = !state.visible.scale; updateStepButtonStates(); drawBothOverlays(); }
  else { setMode('set-scale-draw'); drawBothOverlays(); }
});
// btn-repose removed from UI — handler omitted
$('btn-eye').addEventListener('click', () => {
  // With the eye tracker ON, "Place Eye" means RE-PLACE: arm a click to drop a new
  // marker (which re-captures the pose offset) instead of just toggling visibility.
  if (state.eyeTrackerEnabled) { state._eyeArming = true; state.visible.eye = true; setMode('eye'); return; }
  if (state.eye) { state.visible.eye = !state.visible.eye; updateStepButtonStates(); drawBothOverlays(); }
  else {
    const def = loadSavedStateKey('eye');
    if (def) { pushUndo(); state.eye = def; state.visible.eye = true; updateStepButtonStates(); drawBothOverlays(); updatePointPanel(); setMode('eye'); }
    else setMode('eye');
  }
});
$('btn-thumb').addEventListener('click', () => {
  if (state.thumb) { state.visible.thumb = !state.visible.thumb; updateStepButtonStates(); drawBothOverlays(); }
  else {
    const def = loadSavedStateKey('thumb');
    if (def) { pushUndo(); state.thumb = def; state.visible.thumb = true; updateStepButtonStates(); drawBothOverlays(); updatePointPanel(); setMode('thumb'); }
    else setMode('thumb');
  }
});
$('btn-horizon').addEventListener('click', () => {
  if (state.horizon) { state.visible.horizon = !state.visible.horizon; updateStepButtonStates(); drawBothOverlays(); }
  else {
    const def = loadSavedStateKey('horizon');
    if (def?.p1) { pushUndo(); state.horizon = def; state.visible.horizon = true; updateStepButtonStates(); drawBothOverlays(); }
    else setMode('horizon-p1');
  }
});
// Start (or restart) defining a template slot. Make that slot active up front so
// its in-progress + finished points show in the fine-tune chips and the blade
// toggle reflects it. state.template may be null mid-definition (safe — guarded).
function beginDefineTemplate(slot) {
  state.definingTemplate = slot;
  state.activeTemplate = slot;
  state.template = state.templates[slot];   // null until the 5 clicks complete
  localStorage.setItem('omsni-active-template', String(slot));
  updateBladeToggle();
  setMode('template-grid-p1');
}
// Click behaviour for a Define L button (slot 1 or 2):
//   • not defined yet            → start the 5-click definition
//   • defined but not active     → switch to it AND show it
//   • defined and active         → toggle its visibility (hide / show)
function handleDefineClick(slot) {
  if (!state.templates[slot]?.p1) { beginDefineTemplate(slot); return; }
  if (state.activeTemplate !== slot) {
    setActiveTemplate(slot);
    state.visible.template = true;           // switching always reveals it
  } else {
    state.visible.template = !state.visible.template;
  }
  updateStepButtonStates(); drawBothOverlays();
}
$('btn-define-template').addEventListener('click', () => handleDefineClick(1));
$('btn-define-template-2').addEventListener('click', () => handleDefineClick(2));
$('btn-define-template-3').addEventListener('click', () => handleDefineClick(3));
$('btn-define-template-4').addEventListener('click', async () => {
  // Ensure the custom picture is cached and showing before entering the define flow
  let url = state.checker.customUrl;
  if (!url) {
    url = await window.api.openVideo();
    if (!url) return;
    state.checker.customUrl = url;
    localStorage.setItem('omsni-custom-tpl-pic', url);
  }
  if (state.checker.which !== 'custom') setChecker('custom', url);
  handleDefineClick(4);
});
$('btn-flip-l').addEventListener('click', flipActiveTemplate);
$('btn-board-video').addEventListener('click', () => { state.checker.which = null; redrawPrimaryChecker(); });
$('btn-board-1').addEventListener('click', () => setChecker('L1', '../blade_checkerboard.jpeg'));
$('btn-board-2').addEventListener('click', () => setChecker('L2', '../blade_checkerboard2.jpeg'));
$('btn-board-3').addEventListener('click', () => setChecker('L3', '../blade_checkerboard3.jpeg'));
$('btn-board-c').addEventListener('click', async () => {
  if (state.checker.which === 'custom') { setChecker('custom', state.checker.customUrl); return; }  // toggle off
  if (state.checker.customUrl) { setChecker('custom', state.checker.customUrl); return; }  // restore cached — no prompt
  const url = await window.api.openVideo();   // first time: prompt
  if (!url) return;
  state.checker.customUrl = url;
  localStorage.setItem('omsni-custom-tpl-pic', url);
  setChecker('custom', url);
});
function getFrontFoot() { return localStorage.getItem('omsni-xl-foot') || 'Right'; }
function setFrontFoot(v) {
  localStorage.setItem('omsni-xl-foot', v);
  const tb = $('btn-foot-toggle'); if (tb) tb.textContent = `Front leg: ${v}`;
  const xl = $('xl-foot-toggle');  if (xl) xl.textContent = v;
}
$('btn-foot-toggle').addEventListener('click', () => setFrontFoot(getFrontFoot() === 'Right' ? 'Left' : 'Right'));
setFrontFoot(getFrontFoot());  // initialise label from saved value

function getFrontEye() { return localStorage.getItem('omsni-front-eye') || 'Right'; }
function setFrontEye(v) {
  localStorage.setItem('omsni-front-eye', v);
  const tb = $('btn-eye-toggle'); if (tb) tb.textContent = `Front eye: ${v}`;
}
{ const eb = $('btn-eye-toggle'); if (eb) { eb.addEventListener('click', () => setFrontEye(getFrontEye() === 'Right' ? 'Left' : 'Right')); setFrontEye(getFrontEye()); } }

// ── Grip style ──────────────────────────────────────────────────────────
function getGripStyle()  { return localStorage.getItem('omsni-grip-style') || ''; }
function getGripCustom() { return localStorage.getItem('omsni-grip-custom') || ''; }
function getGripLabel()  {
  const v = getGripStyle(); if (!v) return '';
  return v === 'custom' ? (getGripCustom() || 'Custom') : v;
}
function _syncGripUI() {
  const v = getGripStyle(), c = getGripCustom(), lbl = getGripLabel();
  const sel = $('grip-style-select');    if (sel) sel.value = v;
  const inp = $('grip-custom-input');    if (inp) { inp.style.display = v === 'custom' ? '' : 'none'; inp.value = c; }
  const clbl = $('grip-current-label'); if (clbl) clbl.textContent = lbl ? `Current: ${lbl}` : '';
  const xlSel = $('xl-grip-select');     if (xlSel) xlSel.value = v;
  const xlInp = $('xl-grip-custom');     if (xlInp) { xlInp.style.display = v === 'custom' ? '' : 'none'; xlInp.value = c; }
}
function setGripStyle(v, customText) {
  localStorage.setItem('omsni-grip-style', v);
  if (customText !== undefined) localStorage.setItem('omsni-grip-custom', customText);
  _syncGripUI();
}
{ const sel = $('grip-style-select');
  if (sel) sel.addEventListener('change', () => {
    setGripStyle(sel.value);
    const inp = $('grip-custom-input');
    if (inp && sel.value === 'custom') inp.focus();
  });
}
{ const inp = $('grip-custom-input'); if (inp) inp.addEventListener('input', () => setGripStyle('custom', inp.value)); }
{ const btn = $('btn-grip-panel');
  if (btn) btn.addEventListener('click', () => {
    const open = !btn.classList.contains('active');
    btn.classList.toggle('active', open);
    const p = $('grip-panel'); if (p) p.style.display = open ? '' : 'none';
  });
}
{ const sel = $('xl-grip-select');
  if (sel) sel.addEventListener('change', () => { setGripStyle(sel.value); });
}
{ const inp = $('xl-grip-custom'); if (inp) inp.addEventListener('input', () => setGripStyle('custom', inp.value)); }
_syncGripUI();

// ── Operator initials ───────────────────────────────────────────────────
function getInitials() { return (localStorage.getItem('omsni-initials') || '').toUpperCase().slice(0, 3); }
function setInitials(v) {
  const val = String(v || '').toUpperCase().slice(0, 3);
  localStorage.setItem('omsni-initials', val);
  const inp = $('initials-input');    if (inp) inp.value = val;
  const xl  = $('xl-initials-input'); if (xl)  xl.value  = val;
}
{ const inp = $('initials-input'); if (inp) inp.addEventListener('input', () => setInitials(inp.value)); }
{ const inp = $('xl-initials-input'); if (inp) inp.addEventListener('input', () => setInitials(inp.value)); }
{ const btn = $('btn-initials-panel');
  if (btn) btn.addEventListener('click', () => {
    const open = !btn.classList.contains('active');
    btn.classList.toggle('active', open);
    const p = $('initials-panel'); if (p) p.style.display = open ? '' : 'none';
    if (open) { const inp = $('initials-input'); if (inp) inp.focus(); }
  });
}
setInitials(getInitials());
$('btn-blade-toggle').addEventListener('click', () => {
  // Cycle through DEFINED blade templates only (1 → 2 → 3 → custom → 1)
  const order = [1, 2, 3, 4].filter(n => state.templates[n] && state.templates[n].p1);
  if (order.length < 2) return;
  const i = order.indexOf(state.activeTemplate);
  setActiveTemplate(order[(i + 1) % order.length]);
});
$('btn-fit-l').addEventListener('click', () => {
  if (state.lfit) { state.visible.lfit = !state.visible.lfit; updateStepButtonStates(); drawBothOverlays(); }
  else if (!state.template) {
    // Flash Define L button to signal prerequisite
    const b = $('btn-define-template');
    b.style.outline = '2px solid #f03e3e';
    setTimeout(() => { b.style.outline = ''; }, 900);
  }
  else setMode('lfit-p1');
});
$('btn-undo').addEventListener('click', undo);
$('btn-export-xl').addEventListener('click', () => { if (!segRequireFile()) return; openExcelModal(); });
$('btn-xl-confirm').addEventListener('click', doExportExcel);
$('btn-xl-cancel').addEventListener('click', () => els.modalExportXl.classList.add('hidden'));
$('xl-foot-toggle').addEventListener('click', () => setFrontFoot(getFrontFoot() === 'Right' ? 'Left' : 'Right'));
$('xl-eye-toggle').addEventListener('click', () => {
  setFrontEye(getFrontEye() === 'Right' ? 'Left' : 'Right');
  const b = $('xl-eye-toggle'); if (b) b.textContent = getFrontEye();
});
$('xl-dryrun-toggle').addEventListener('click', () => {
  const b = $('xl-dryrun-toggle'); if (!b) return;
  const yes = b.textContent !== 'Yes';
  b.textContent = yes ? 'Yes' : 'No';
  b.style.background   = yes ? '#2b5a3e' : '#25252b';
  b.style.borderColor  = yes ? '#51cf66' : '#555';
  b.style.color        = yes ? '#fff'    : '#e8e8ea';
});
$('xl-units-toggle').addEventListener('click', () => {
  const cur = localStorage.getItem('omsni-xl-units') || state.units;
  const next = cur === 'cm' ? 'in' : 'cm';
  localStorage.setItem('omsni-xl-units', next);
  $('xl-units-toggle').textContent = next;
});
$('btn-xl-change').addEventListener('click', async () => {
  const p = await window.api.pickXlsxPath(localStorage.getItem('omsni-xl-path') || 'measurements.xlsx');
  if (p) {
    localStorage.setItem('omsni-xl-path', p);
    const pathEl = document.getElementById('xl-path-display');
    if (pathEl) pathEl.textContent = `File: ${p}`;
  }
});
// ── Pose toggle ───────────────────────────────────────────────────────────
function startPoseEngine() {
  if (window.PoseEngine) { window.PoseEngine.warmup(); schedulePose(); }
  else window.addEventListener('pose-engine-ready',
    () => { if (state.poseEnabled) { window.PoseEngine.warmup(); schedulePose(); } }, { once: true });
}
$('btn-pose').addEventListener('click', () => {
  state.poseEnabled = !state.poseEnabled;
  $('btn-pose').classList.toggle('active', state.poseEnabled);
  if (state.poseEnabled) {
    startPoseEngine();
  } else {
    state.poseCurrent = null;
    state.poseInflight = null;
    if (typeof state.selectedPointId === 'string' && state.selectedPointId.startsWith('pose')) state.selectedPointId = null;
  }
  drawOverlay('primary'); updatePointPanel(); updatePoseReadout();
});
// Confidence slider — sets the visibility threshold below which a hip angle is
// still reported but flagged ⚠. Changing it just re-evaluates the overlay; the
// landmarks are unchanged so no re-detection is needed.
(() => {
  const s = $('pose-conf'), v = $('pose-conf-val');
  if (!s) return;
  s.value = Math.round(POSE_VIS_MIN * 100);
  if (v) v.textContent = `${s.value}%`;
  s.addEventListener('input', () => {
    POSE_VIS_MIN = (+s.value) / 100;
    localStorage.setItem('omsni-pose-conf', POSE_VIS_MIN);
    if (v) v.textContent = `${s.value}%`;
    drawOverlay('primary'); updatePointPanel(); updatePoseReadout();
  });
})();
// Sticky front-of-body direction (S key, foot-badge click, or this button).
function setPoseFront(val) {
  state.poseFront = (val === 'L') ? 'L' : 'R';
  localStorage.setItem('omsni-pose-front', state.poseFront);
  drawBothOverlays(); updatePointPanel(); updatePoseReadout();
}
function togglePoseFront() { setPoseFront(state.poseFront === 'R' ? 'L' : 'R'); }
// Temporal-smoothing window selector — re-runs the current frame through the median.
(() => {
  const sel = $('pose-smooth'); if (!sel) return;
  sel.value = String(state.poseSmooth);
  sel.addEventListener('change', () => {
    state.poseSmooth = parseInt(sel.value, 10) || 1;
    localStorage.setItem('omsni-pose-smooth', state.poseSmooth);
    state.poseDetCache.clear();    // cached results are window-size specific
    ensurePoseForFrame();          // recompute current frame with the new window
    updatePoseReadout();
    // Blade smoothing follows the same N → invalidate its cache and re-track.
    if (state.bladeTrackerEnabled) { resetBladeTracker(); forceBladeRetrack(); }
  });
})();

// Secondary-view rotation-angle tabs (Angle F, Angle Finger)
function clearSecLayer(key) {
  if (SEC_MODES.includes(state.mode)) setMode(null);
  pushUndo(); state[key] = null; state.visible[key] = true;
  persistSec();
  updateStepButtonStates(); drawOverlay('secondary'); updatePointPanel();
}
function startSecLayer(key) {
  const cfg = SEC_LAYER_CFG[key];
  if (state[key]?.p2) {                          // already placed → toggle visibility
    state.visible[key] = !state.visible[key]; updateStepButtonStates(); drawOverlay('secondary');
  } else {
    if (!state.secondary.ready) { alert('Load a Secondary video first — these angles are measured on the secondary camera.'); return; }
    setMode(cfg.p1mode);
  }
}
$('btn-sec-hor').addEventListener('click', () => startSecLayer('secHorizon'));
$('clear-sec-hor').addEventListener('click', () => clearSecLayer('secHorizon'));
$('btn-sec-f').addEventListener('click', () => startSecLayer('secF'));
$('clear-sec-f').addEventListener('click', () => clearSecLayer('secF'));
$('btn-sec-finger').addEventListener('click', () => startSecLayer('secFinger'));
$('clear-sec-finger').addEventListener('click', () => clearSecLayer('secFinger'));
// $('btn-log') removed from toolbar — log path auto-saves silently
$('btn-load-defaults').addEventListener('click', loadEmbeddedDefaults);
// Segment files: New / Open / Save / Save As, and the SEGMENT dropdown.
$('btn-seg-new').addEventListener('click', segNewFile);
$('btn-seg-open').addEventListener('click', segOpenFile);
$('btn-seg-saveas').addEventListener('click', segSaveAs);
$('btn-seg-save').addEventListener('click', () => {
  if (state.segFile) { if (segSaveActive()) flashSegSaved(); }
  else segSaveAs();   // first save with no file → Save As
});
function flashSegSaved() { const b = $('btn-seg-save'); if (b) { const t = b.textContent; b.textContent = 'Saved'; setTimeout(() => b.textContent = t, 800); } }
$('seg-select').addEventListener('change', (e) => {
  const i = parseInt(e.target.value, 10);
  if (i >= 0) selectSegment(i);
});
// Segment actions
$('btn-seg-start').addEventListener('click', markSegStart);
$('btn-seg-end').addEventListener('click', markSegEnd);
$('btn-seg-add').addEventListener('click', addSegment);
$('btn-seg-compute').addEventListener('click', togglePlay);
$('btn-seg-compute-all').addEventListener('click', onCompute);
{ const b = $('btn-audio-toggle'); if (b) b.addEventListener('click', () => {
  state.audioEnabled = !state.audioEnabled;
  if (state.audioEnabled) {
    // Auto-switch to 1x so RVFC play mode is always used with audio
    const sp = $('play-speed'); if (sp) sp.value = '1';
  }
  b.classList.toggle('active', state.audioEnabled);
  if (!state.audioEnabled && state.primary.el) state.primary.el.muted = true;
  localStorage.setItem('omsni-audio-enabled', state.audioEnabled ? '1' : '0');
}); }
{ const b = $('btn-audio-toggle'); if (b) b.classList.toggle('active', state.audioEnabled); }
$('play-speed').addEventListener('change', () => updateAudioToggleState());
$('btn-seg-exclude').addEventListener('click', excludeCurrentFrame);
$('btn-seg-panel').addEventListener('click', () => {
  const p = $('seg-panel'); if (!p) return;
  const show = p.classList.toggle('hidden') === false;
  $('btn-seg-panel').classList.toggle('active', show);
  if (show) segRenderPanel();
});
let _lastExportFrame = null;
$('export-jump').addEventListener('change', (e) => {
  const v = e.target.value; e.target.value = '';
  if (v === '') return;
  _lastExportFrame = +v;
  const btn = $('btn-export-remove');
  if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  const _pos = exportFramePos(+v);
  const _fOpt = $('export-jump')?.options[0];
  if (_fOpt) _fOpt.textContent = _pos ? `Export #${_pos} ▾` : 'Export ▾';
  // Export-at-frame is a protected, exact snapshot. Turn the blade tracker off
  // FIRST (before the seek/restore) so no in-flight or newly-scheduled blade
  // detection can overwrite the restored Fit L — every blade code path checks
  // state.bladeTrackerEnabled AFTER any await, so this fully guards the restore.
  if (typeof disableBladeTracker === 'function') disableBladeTracker();
  // Same protection for the eye tracker — its per-frame pose reconstruction must
  // not move the restored red eye on a protected export frame.
  if (typeof disableEyeTracker === 'function') disableEyeTracker();
  goToFrame(+v);
  // Restore the export-time POINT POSITIONS (so the exported measurement is exactly
  // reproducible) but KEEP the user's current layer visibility — jumping to an
  // export checkpoint should not force Scale on or flip other layers off/on (that
  // felt unnatural). applyDefs sets several state.visible flags true, so snapshot
  // and restore visibility around it.
  const snap = state.exportDefs[+v];
  if (snap) {
    applyDefs(snap, { scale: 1, lfit: 1, eye: 1, thumb: 1, horizon: 1, secondary: 1, template: 1 });
    // Show the layers exactly as they were AT EXPORT TIME (so the exported
    // measurement is visible) — NOT the current visibility, which after a fresh/
    // loaded segment file is all-hidden (that made everything vanish on a jump).
    if (snap.visible) Object.assign(state.visible, snap.visible);
    // …except NEVER the Set Scale line — it's calibration, not a measurement to
    // view, and forcing it on was the "scale turned on / hid everything" report.
    state.visible.scale = false;
    updateStepButtonStates();
  }
  drawBothOverlays();
  requestAnimationFrame(() => { if (state.primary.ready) drawFrame(state.primary); });
});
$('btn-export-remove').addEventListener('click', () => {
  if (_lastExportFrame == null) return;
  const f = _lastExportFrame;
  if (!confirm(`This will NOT remove the row from your Excel file.\nIt only removes the export checkpoint at frame ${f} from the session file — the saved visual settings and scrollbar dot for that frame will be gone.\n\nRemove export @ frame ${f}?`)) return;
  state.exportMarks = (state.exportMarks || []).filter(m => m !== f);
  delete state.exportDefs[f];
  _lastExportFrame = null;
  const btn = $('btn-export-remove');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; }
  drawSegBars(); refreshExportJump(); segScheduleSave();
});
$('btn-load-defs-confirm').addEventListener('click', loadSelectedDefs);
$('btn-load-defs-file').addEventListener('click', loadDefsFromFile);
$('btn-load-defs-cancel').addEventListener('click', () => $('modal-load-defs').classList.add('hidden'));

// Scale modal — interprets input in current display units, stores internally as cm
$('btn-scale-confirm').addEventListener('click', () => {
  const userVal = parseFloat(els.inputBladeCm.value);
  if (!userVal || userVal <= 0 || !state.scratch.p1 || !state.scratch.p2) return;
  const cm = toCm(userVal);  // convert from user unit to cm

  // Compute scale in video pixels (display-resolution-invariant)
  const srcId = state.primary.ready ? 'primary' : 'secondary';
  const dims = getNativeDims(srcId); if (!dims) return;
  const { w: vW, h: vH } = dims;
  const dx = (state.scratch.p2.x - state.scratch.p1.x) * vW;
  const dy = (state.scratch.p2.y - state.scratch.p1.y) * vH;
  const vpLen = Math.hypot(dx, dy);
  if (vpLen === 0) return;

  pushUndo();
  state.scale = {
    p1: state.scratch.p1,
    p2: state.scratch.p2,
    cm,
    videoPxPerCm: vpLen / cm,
  };

  state.visible.scale = true;
  els.modalScale.classList.add('hidden');
  updateStepButtonStates();
  setMode(null);
  drawBothOverlays();
});

$('btn-scale-cancel').addEventListener('click', () => {
  state.scratch = {};
  els.modalScale.classList.add('hidden');
  setMode(null);
  drawBothOverlays();
});

// Grid-scale modal (Define L step 2/5)
$('btn-grid-scale-confirm').addEventListener('click', () => {
  const inches = parseFloat(els.inputGridInches.value);
  if (!inches || inches <= 0) return;
  const { gp1, gp2 } = state.scratch;
  if (!gp1 || !gp2) return;
  const dims = getNativeDims('primary'); if (!dims) return;
  const { w: vW, h: vH } = dims;
  const distPx = Math.hypot((gp2.x - gp1.x) * vW, (gp2.y - gp1.y) * vH);
  if (distPx === 0) return;
  state.scratch.gridInches = inches;
  state.scratch.photoPxPerCm = distPx / (inches * CM_PER_IN);
  els.modalGridScale.classList.add('hidden');
  state.mode = 'template-p1';
  drawBothOverlays();
});

$('btn-grid-scale-cancel').addEventListener('click', () => {
  state.scratch = {};
  els.modalGridScale.classList.add('hidden');
  setMode(null);
  drawBothOverlays();
});

// Units toggle
$('btn-units').addEventListener('click', () => {
  state.units = state.units === 'cm' ? 'in' : 'cm';
  $('btn-units').textContent = state.units;
  els.lblScaleUnit.textContent = state.units;
  localStorage.setItem('omsni-xl-units', state.units);
  const xlU = $('xl-units-toggle'); if (xlU) xlU.textContent = state.units;
  drawBothOverlays();
  if (state.primary.ready) updateReadout(getVideoRect('primary'));
  if (typeof segRenderPanel === 'function') segRenderPanel();   // blade joint-displacement readout follows the unit
});

// ── Per-element clear buttons ─────────────────────────────────────────
function clearLayer(key) {
  pushUndo();
  state[key] = null;
  state.visible[key] = true;  // reset to visible so next placement is shown
  updateStepButtonStates();
  drawBothOverlays();
}
$('clear-scale').addEventListener('click',    () => clearLayer('scale'));
$('clear-horizon').addEventListener('click',  () => clearLayer('horizon'));
$('clear-eye').addEventListener('click',      () => {
  // Removing the eye while the tracker is on would instantly re-appear (tracking
  // re-creates it), so turn the tracker + its stored offset off first.
  if (state.eyeTrackerEnabled || state.eyeOffset) { disableEyeTracker(); state.eyeOffset = null; segScheduleSave(); }
  clearLayer('eye');
});
$('clear-thumb').addEventListener('click',    () => clearLayer('thumb'));
function clearTemplateSlot(slot) {
  const TMPL = ['template-grid-p1','template-grid-p2','template-p1','template-p2','template-p3'];
  if (TMPL.includes(state.mode)) setMode(null);  // cancels mode + clears scratch
  pushUndo();
  state.templates[slot] = null;
  localStorage.removeItem(TPL_KEY(slot));
  if (slot === 4) {
    state.checker.customUrl = null;
    localStorage.removeItem('omsni-custom-tpl-pic');
    if (state.checker.which === 'custom') { state.checker.which = null; redrawPrimaryChecker(); }
  }
  // If the cleared slot was active, fall back to blade 1 (always defined)
  if (state.activeTemplate === slot) {
    state.activeTemplate = 1; localStorage.setItem('omsni-active-template','1');
    state.template = state.templates[1];
  }
  updateBladeToggle();
  updateStepButtonStates();
  drawBothOverlays();
}
// Only the custom blade (slot 4) is user-clearable; blades 1/2/3 are fixed (no ×)
$('clear-template-4').addEventListener('click', () => clearTemplateSlot(4));
// Clear just the custom picture (keeps the Lc geometry) so a new picture can be picked
$('clear-board-c').addEventListener('click', () => {
  state.checker.customUrl = null;
  localStorage.removeItem('omsni-custom-tpl-pic');
  if (state.checker.which === 'custom') { state.checker.which = null; redrawPrimaryChecker(); }
});
$('clear-lfit').addEventListener('click', () => clearLayer('lfit'));

// ── Fps manual override ───────────────────────────────────────────────
['primary', 'secondary'].forEach(id => {
  const input = id === 'primary' ? els.fpsPrimary : els.fpsSecondary;
  input.addEventListener('change', () => {
    const fps = parseFloat(input.value);
    if (!fps || fps < 1 || fps > 300) return;
    applyFps(id, fps);
    setFpsStatus(id, 'manual');
  });
});

// ── Blade rotation via scroll wheel ──────────────────────────────────
// Use document capture so the event is intercepted before Chromium can
// treat it as a passive scroll (wrap-level listeners can be silently
// ignored as passive in Electron's Chromium when content is scrollable).
{
  let wheelUndoTimer = null;
  document.addEventListener('wheel', e => {
    if (!state.repose && !state.lfit) return;
    const over = els.wrapPrimary.contains(e.target) || els.wrapSecondary.contains(e.target)
              || e.target === els.wrapPrimary || e.target === els.wrapSecondary;
    if (!over) return;
    e.preventDefault();
    if (!wheelUndoTimer) pushUndo();
    clearTimeout(wheelUndoTimer);
    wheelUndoTimer = setTimeout(() => { wheelUndoTimer = null; }, 400);
    const step = Math.sign(e.deltaY) * (e.shiftKey ? STEP_FINE : STEP_COARSE);
    if (state.repose) state.repose.angle += step;
    if (state.lfit) rotateLFit(step);
    drawBothOverlays();
  }, { capture: true, passive: false });
}

// ── Point fine-tune panel ─────────────────────────────────────────────
function getActivePoints() {
  const pts = [];
  const add = (id, name, color, get, set, panel='primary') => pts.push({ id, name, color, get, set, panel });
  if (state.template) {
    if (state.template.gp1) add('gp1','Grid 1','#ffd43b', ()=>state.template.gp1, p=>{state.template.gp1=p;});
    if (state.template.gp2) add('gp2','Grid 2','#ffd43b', ()=>state.template.gp2, p=>{state.template.gp2=p;});
    if (state.template.p1)  add('tp1','L Base', '#74c0fc', ()=>state.template.p1,  p=>{const oja=rawJointAngle(); state.template.p1=p; recomputeTemplateDimensions(oja);});
    if (state.template.p2)  add('tp2','L Joint','#51cf66', ()=>state.template.p2,  p=>{const oja=rawJointAngle(); state.template.p2=p; recomputeTemplateDimensions(oja);});
    if (state.template.p3)  add('tp3','L Tip',  '#a5d8ff', ()=>state.template.p3,  p=>{const oja=rawJointAngle(); state.template.p3=p; recomputeTemplateDimensions(oja);});
  }
  if (state.scale?.p1) {
    add('sp1','Scale P1','#4dabf7', ()=>state.scale.p1, p=>{ state.scale.p1=p; recalcScale(); });
    add('sp2','Scale P2','#4dabf7', ()=>state.scale.p2, p=>{ state.scale.p2=p; recalcScale(); });
  }
  if (state.eye)         add('eye','Eye',      '#f03e3e', ()=>state.eye,           p=>{state.eye=p;});
  if (state.thumb)       add('thm','Finger',   '#fd7e14', ()=>state.thumb,         p=>{state.thumb=p;});
  if (state.horizon?.p1) add('hp1','Horiz P1', '#ffd43b', ()=>state.horizon.p1,   p=>{state.horizon.p1=p;});
  if (state.horizon?.p2) add('hp2','Horiz P2', '#ffd43b', ()=>state.horizon.p2,   p=>{state.horizon.p2=p;});
  if (state.lfit?.base)  add('lb', 'Fit Base', '#74c0fc', ()=>state.lfit.base, p=>{
    const dx=p.x-state.lfit.base.x, dy=p.y-state.lfit.base.y;
    state.lfit.base=p;
    if (state.lfit.joint) state.lfit.joint={x:state.lfit.joint.x+dx, y:state.lfit.joint.y+dy};
  });
  if (state.lfit?.joint) add('lj', 'Fit Joint','#51cf66', ()=>getLFitJoint()||state.lfit.joint, p=>{state.lfit.joint=p;});
  const _lfTip = state.lfit ? getLFitTip() : null;
  if (_lfTip) add('lt', 'Fit Tip', '#a5d8ff', ()=>getLFitTip()||state.lfit.base, p=>{
    const t=getLFitTip(); if (!t||!state.lfit) return;
    const dx=p.x-t.x, dy=p.y-t.y;
    state.lfit.base  = {x:state.lfit.base.x+dx,  y:state.lfit.base.y+dy};
    state.lfit.joint = {x:state.lfit.joint.x+dx, y:state.lfit.joint.y+dy};
  });
  // Pose key landmarks (shoulder/hip/knee × 2) — draggable, pre-filled by the pose model.
  if (state.poseEnabled && state.poseCurrent?.landmarks && state.poseCurrent.frame === state.frame) {
    const L = state.poseCurrent.landmarks;
    const asg = poseSideAssignment(L, getVideoRect('primary'));
    const mk = (idx, name, side) => add('pose' + idx, `${side} ${name}`, POSE_COL[side],
      () => ({ x: L[idx].x, y: L[idx].y }),
      p => { L[idx].x = p.x; L[idx].y = p.y; L[idx].visibility = 1; markPoseEdited(); });
    mk(11, 'Shoulder', asg.A); mk(23, 'Hip', asg.A); mk(25, 'Knee', asg.A);
    mk(12, 'Shoulder', asg.B); mk(24, 'Hip', asg.B); mk(26, 'Knee', asg.B);
  }
  // Secondary-view rotation-angle points (fine-tuned in the secondary panel)
  if (state.secHorizon?.p1) add('shp1','Sec Horiz P1','#ffd43b',()=>state.secHorizon.p1,p=>{state.secHorizon.p1=p;},'secondary');
  if (state.secHorizon?.p2) add('shp2','Sec Horiz P2','#ffd43b',()=>state.secHorizon.p2,p=>{state.secHorizon.p2=p;},'secondary');
  if (state.secF?.p1)      add('sfa','F P1 (S)',     '#20c997',()=>state.secF.p1,     p=>{state.secF.p1=p;},     'secondary');
  if (state.secF?.p2)      add('sfb','F P2 (S)',     '#20c997',()=>state.secF.p2,     p=>{state.secF.p2=p;},     'secondary');
  if (state.secFinger?.p1) add('sga','Finger P1 (S)','#ff922b',()=>state.secFinger.p1,p=>{state.secFinger.p1=p;},'secondary');
  if (state.secFinger?.p2) add('sgb','Finger P2 (S)','#ff922b',()=>state.secFinger.p2,p=>{state.secFinger.p2=p;},'secondary');
  return pts;
}

function updatePointPanel() {
  const panel = els.pointPanel;
  if (!panel) return;
  const pts = getActivePoints();
  if (pts.length === 0) { panel.innerHTML = ''; return; }
  panel.innerHTML = '<span style="color:#888;font-size:11px;margin-right:4px">Fine-tune:</span>' +
    pts.map(p => {
      const sel = state.selectedPointId === p.id;
      return `<span class="pt-chip${sel?' selected':''}" data-pt="${p.id}">` +
        `<span class="dot" style="background:${p.color}"></span>${p.name}</span>`;
    }).join('');
  panel.querySelectorAll('.pt-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.pt;
      state.selectedPointId = (state.selectedPointId === id) ? null : id;
      // Ensure the relevant layer is visible when selecting its chip
      if (id === 'sp1' || id === 'sp2') { state.visible.scale = true; updateStepButtonStates(); }
      drawBothOverlays();
    });
  });
}

// ── Scale / lfit defaults persistence ────────────────────────────────
function saveDefaults() {
  if (state.scale?.videoPxPerCm > 0)
    localStorage.setItem('omsni-scale-v2', state.scale.videoPxPerCm);
  if (state.lfit)
    localStorage.setItem('omsni-default-lfit', JSON.stringify({
      angleOffset: state.lfit.angleOffset,
      videoPxPerCm: state.lfit.videoPxPerCm,
    }));
}

// ── Named defaults: save many sets, load selectively ──────────────────
function snapshotState() {
  return {
    eye: state.eye, thumb: state.thumb, horizon: state.horizon,
    hip: state.hip, lfit: state.lfit, scale: state.scale,
    template: state.template, templates: state.templates, activeTemplate: state.activeTemplate,
    secF: state.secF, secFinger: state.secFinger, secHorizon: state.secHorizon,
    visible: { ...state.visible },
  };
}
function getDefsIndex() { try { return JSON.parse(localStorage.getItem('omsni-defs-index')) || []; } catch(e) { return []; } }
function setDefsIndex(a) { localStorage.setItem('omsni-defs-index', JSON.stringify(a)); }

// Save Defs → write to a file the user picks, AND register it in the Load list
// (under the file's base name) so it sits next to "default".
async function saveNamedDefs() {
  const json = JSON.stringify(snapshotState(), null, 2);
  const filePath = await window.api.saveDefsFile(json);
  if (!filePath) return;  // cancelled
  const name = filePath.split(/[/\\]/).pop().replace(/\.json$/i, '');
  const idx = getDefsIndex();
  localStorage.setItem('omsni-defs:' + name, json);
  if (!idx.includes(name)) { idx.push(name); setDefsIndex(idx); }
  localStorage.setItem('omsni-defs-last', name);
  // Mirror into legacy key so per-tab default pre-load keeps working
  localStorage.setItem('omsni-saved-state', json);
  saveDefaults();
  alert(`Saved defaults to:\n${filePath}\n\nAlso available in Load Defs as "${name}".`);
}

// Legacy per-tab default pre-load (eye/thumb/horizon/hip tab clicks read this)
function loadSavedStateKey(key) {
  try {
    const s = localStorage.getItem('omsni-saved-state');
    return s ? (JSON.parse(s)[key] ?? null) : null;
  } catch(e) { return null; }
}

function openLoadDefsModal() {
  const idx = getDefsIndex();
  const sel = $('load-defs-select');
  sel.innerHTML = idx.length
    ? idx.map(n => `<option value="${n}">${n}</option>`).join('')
    : '<option value="" disabled>(no saved sets — use “Load from file…”)</option>';
  const last = localStorage.getItem('omsni-defs-last');
  if (last && idx.includes(last)) sel.value = last;
  $('modal-load-defs').classList.remove('hidden');
}

// Apply a defs object. `want` selects categories; when omitted, applies everything
// (used at startup). Loaded layers are forced VISIBLE so they never come back
// hidden — visibility is then a live toggle via each layer's button.
function applyDefs(data, want) {
  if (!data) { alert('Could not read that defaults set.'); return; }
  data = JSON.parse(JSON.stringify(data));   // deep copy — prevents mutations from corrupting the source (e.g. EMBEDDED_DEFAULTS)
  if (!want) {
    want = {};
    $('load-defs-items').querySelectorAll('input[type=checkbox]').forEach(cb => want[cb.dataset.k] = cb.checked);
  }
  pushUndo();
  if (want.scale   && data.scale)   { state.scale   = data.scale;   state.visible.scale   = true; }
  if (want.lfit    && data.lfit)    { state.lfit    = data.lfit;    state.visible.lfit    = true; }
  if (want.eye     && data.eye)     { state.eye     = data.eye;     state.visible.eye     = true; }
  if (want.thumb   && data.thumb)   { state.thumb   = data.thumb;   state.visible.thumb   = true; }
  if (want.horizon && data.horizon) { state.horizon = data.horizon; state.visible.horizon = true; }
  if (want.secondary) {
    // Take the set's secondary measurements; if the set lacks any, keep the
    // embedded defaults so loading a ref ALWAYS brings in F / finger / horizon.
    if (data.secF)       state.secF       = data.secF;
    if (data.secFinger)  state.secFinger  = data.secFinger;
    if (data.secHorizon) state.secHorizon = data.secHorizon;
    if (!state.secF)       state.secF       = { ...EMBEDDED_SECF };
    if (!state.secFinger)  state.secFinger  = { ...EMBEDDED_SECFINGER };
    if (!state.secHorizon) state.secHorizon = { ...EMBEDDED_SECHORIZON };
    state.visible.secF = true; state.visible.secFinger = true; state.visible.secHorizon = true;
    persistSec();
  }
  if (want.template) {
    // Fixed blades 1/2/3 are EMBEDDED and must NEVER be overwritten by a loaded
    // defs set — old sets carry blade 3's data in slot 2, which was making
    // Define L2 identical to L3 on load. Only the user's custom blade (slot 4)
    // is taken from the set; blades 1/2/3 stay the correct embedded definitions.
    if (data.templates && data.templates[4]) { state.templates[4] = data.templates[4]; persistTemplate(4); }
    if (data.activeTemplate) {
      state.activeTemplate = data.activeTemplate;
      state.template = state.templates[state.activeTemplate] || null;
      localStorage.setItem('omsni-active-template', String(state.activeTemplate));
    }
  }
  $('modal-load-defs').classList.add('hidden');
  updateBladeToggle(); updateStepButtonStates(); drawBothOverlays(); updatePointPanel();
}

function loadSelectedDefs() {
  const name = $('load-defs-select').value;
  if (!name) { alert('No set selected. Use “Load from file…” to pick a defaults file.'); return; }
  let data; try { data = JSON.parse(localStorage.getItem('omsni-defs:' + name)); } catch(e) {}
  localStorage.setItem('omsni-defs-last', name);
  applyDefs(data);
}

async function loadDefsFromFile() {
  const res = await window.api.loadDefsFile();
  if (!res) return;  // cancelled
  let data; try { data = JSON.parse(res.content); } catch(e) { alert('That file is not a valid defaults file.'); return; }
  // A segment file (has a `segments` array) goes through the segment loader so
  // the "Load Defs → Load from file…" control can also open segment files.
  if (data && Array.isArray(data.segments)) {
    $('modal-load-defs')?.classList.add('hidden');
    await segLoadContent(res.path, res.content, data);
    return;
  }
  // Register it in the list under its base name for next time
  const name = res.path.split(/[/\\]/).pop().replace(/\.json$/i, '');
  const idx = getDefsIndex();
  localStorage.setItem('omsni-defs:' + name, res.content);
  if (!idx.includes(name)) { idx.push(name); setDefsIndex(idx); }
  localStorage.setItem('omsni-defs-last', name);
  applyDefs(data);
}

// ── Load Defaults — one-click restore of the embedded tuned default points ──
function loadEmbeddedDefaults() {
  applyDefs(EMBEDDED_DEFAULTS, { scale: 1, lfit: 1, eye: 1, thumb: 1, horizon: 1, secondary: 1, template: 1 });
}

// ── Segment files (save/load layer, separate from defaults) ─────────────────
const SEG_WARN = 'All current segments can be lost if you load a new file.';
const SEG_NEED = 'You need to choose an existing JSON or create one to save this, so you can load it again later.';

function segBaseName(path) { return path.split(/[/\\]/).pop().replace(/\.json$/i, ''); }

// The segment file: segments + per-segment pose edits + excluded frames + a
// snapshot of every visual point EXCEPT the auto-pose (which is recomputed,
// never stored). Includes the front-leg / front-eye toggles.
function segBuildData() {
  return {
    version: 2,
    segments: (state.segments || []).map(s => ({
      name: s.name, start: s.start, end: s.end,
      computed: !!s.computed, stats: s.stats || null,
      data: s._data || {},   // per-frame L/R angles so exclude/ignore work after reload
      bladeSubStart: s.bladeSubStart ?? null, bladeSubEnd: s.bladeSubEnd ?? null,
      bladeData: s.bladeData || {}, bladeStats: s.bladeStats || null,
      activeBlade: s.activeBlade ?? null,   // which blade (1/2/3/4) this segment uses
    })),
    currentSegment: state.currentSegment,
    excludedFrames: state.segExcluded || [],
    bladeExcludedFrames: state.bladeExcluded || [],
    eyeExcludedFrames: state.eyeExcluded || [],
    eyeOffset: state.eyeOffset || null,   // red-eye→pose-right-eye transform
    exportMarks: state.exportMarks || [],
    exportDefs: state.exportDefs || {},   // per-export-frame visual snapshot
    poseEdits: state.poseCache || {},   // fine-tuned frames only (frame → landmarks)
    visual: { ...snapshotState(), frontFoot: getFrontFoot(), frontEye: getFrontEye(),
              gripStyle: getGripStyle(), gripCustom: getGripCustom(), initials: getInitials() },
    roi: state.roi || null,
    bladeRoi: state.bladeRoi || null,
    audioTranscript: state.audioTranscript || null,
  };
}

function segApplyData(data, keepVisuals = false) {
  if (!data) return;
  state.segments    = Array.isArray(data.segments) ? data.segments.map(s => ({
    name: s.name || 'Segment', start: s.start ?? null, end: s.end ?? null,
    computed: !!s.computed, stats: s.stats || null, warnings: [],
    _data: (s.data && typeof s.data === 'object') ? s.data : {},
    bladeSubStart: s.bladeSubStart ?? null, bladeSubEnd: s.bladeSubEnd ?? null,
    bladeData: (s.bladeData && typeof s.bladeData === 'object') ? s.bladeData : {},
    bladeStats: s.bladeStats || null,
    activeBlade: s.activeBlade ?? null,
  })) : [];
  state.currentSegment = Math.min(data.currentSegment || 0, Math.max(0, state.segments.length - 1));
  state.segExcluded = Array.isArray(data.excludedFrames) ? data.excludedFrames : [];
  state.bladeExcluded = Array.isArray(data.bladeExcludedFrames) ? data.bladeExcludedFrames : [];
  state.eyeExcluded = Array.isArray(data.eyeExcludedFrames) ? data.eyeExcludedFrames : [];
  state.eyeOffset = (data.eyeOffset && data.eyeOffset.refEye && data.eyeOffset.ref) ? data.eyeOffset : null;
  state.exportMarks = Array.isArray(data.exportMarks) ? data.exportMarks : [];
  state.exportDefs  = (data.exportDefs && typeof data.exportDefs === 'object') ? data.exportDefs : {};
  state.poseCache   = (data.poseEdits && typeof data.poseEdits === 'object') ? data.poseEdits : {};
  sortSegments();
  state.segments.forEach(s => { if (s.computed && s._data && Object.keys(s._data).length) detectWarnings(s); });
  // Loading a new file must not leave a stale tracker/compute running or stale
  // detections that hide the pose on the next compute. Also stop the video if
  // audio-play was active (RVFC exits on its next tick but won't pause on its own).
  state.compute = { running: false, paused: false, mode: null, segIdx: -1, frame: null };
  if (state.primary?.el && !state.primary.el.paused) {
    state.primary.el.pause(); state.primary.el.muted = true;
  }
  state.poseCurrent = null;
  if (state.poseDetCache && state.poseDetCache.clear) state.poseDetCache.clear();
  // Restore ROI — unhidden (active) when loaded from JSON
  if (data.roi && typeof data.roi.x === 'number') {
    state.roi = data.roi; state.roiEnabled = true;
    $('btn-roi')?.classList.add('active');
    if (els.wrapPrimary) els.wrapPrimary.style.cursor = 'crosshair';
  } else {
    state.roi = null; state.roiEnabled = false;
    $('btn-roi')?.classList.remove('active');
    if (els.wrapPrimary) els.wrapPrimary.style.cursor = '';
  }
  // Restore Blade ROI (separate region). Shown but the tracker stays OFF until toggled.
  if (data.bladeRoi && typeof data.bladeRoi.x === 'number') {
    state.bladeRoi = data.bladeRoi; state.bladeRoiEnabled = true;
    $('btn-blade-roi')?.classList.add('active');
  } else {
    state.bladeRoi = null; state.bladeRoiEnabled = false;
    $('btn-blade-roi')?.classList.remove('active');
  }
  state.bladeTrackerEnabled = false;
  $('btn-blade-track')?.classList.remove('active');
  // Eye tracker starts OFF on load (its offset is restored above so re-enabling
  // works without re-placing the marker).
  state.eyeTrackerEnabled = false; state._eyeArming = false; state._eyePinned = null;
  $('btn-eye-track')?.classList.remove('active');
  // Restore audio transcript and refresh UI to reflect loaded state
  state.audioTranscript = (data.audioTranscript && Array.isArray(data.audioTranscript.words)) ? data.audioTranscript : null;
  updateTranscriptUI();
  if (data.visual && !keepVisuals) {
    // applyDefs was designed for interactive use (pushUndo, modal close, etc.); wrap so
    // any failure there never aborts the rest of segApplyData (updateComputeBtns etc.)
    try { applyDefs(data.visual, { scale: 1, lfit: 1, eye: 1, thumb: 1, horizon: 1, secondary: 1, template: 1 }); } catch (e) {}
    // Hide all measurement layers after loading — user reveals them by clicking buttons.
    Object.keys(state.visible).forEach(k => { state.visible[k] = false; });
    if (data.visual.frontFoot) setFrontFoot(data.visual.frontFoot);
    if (data.visual.frontEye)  setFrontEye(data.visual.frontEye);
    if (data.visual.gripStyle !== undefined) setGripStyle(data.visual.gripStyle, data.visual.gripCustom);
    if (data.visual.initials  !== undefined) setInitials(data.visual.initials);
  }
  restoreSegActiveBlade();   // #1: adopt the loaded current segment's stored blade
  segRenderPanel(); drawSegBars(); refreshExportJump(); updateComputeBtns();
  if (state.poseEnabled) schedulePose();   // refresh the live pose for the new file
}

function segSetActive(name, path) {
  state.segFile = { name, path };
  localStorage.setItem('omsni-seg-active', JSON.stringify(state.segFile));
  segUpdateFileName();
  segRefreshSegDropdown();
}

// Show the active file's name in the toolbar.
function segUpdateFileName() {
  const el = $('seg-file-name'); if (!el) return;
  el.textContent = state.segFile ? state.segFile.name : 'no file';
  el.style.color = state.segFile ? '#cdd' : '#888';
}

// The dropdown lists the SEGMENTS inside the active file, to pick the current one.
function segRefreshSegDropdown() {
  const sel = $('seg-select'); if (!sel) return;
  const segs = state.segments || [];
  if (!segs.length) { sel.innerHTML = '<option value="-1">(no segments)</option>'; sel.value = '-1'; return; }
  if (state.currentSegment >= segs.length) state.currentSegment = segs.length - 1;
  sel.innerHTML = segs.map((s, i) => `<option value="${i}"${i === state.currentSegment ? ' selected' : ''}>${i + 1}</option>`).join('');
}

function sortSegments() {
  if (!state.segments.length) return;
  const cur = state.segments[state.currentSegment];
  state.segments.sort((a, b) => {
    if (a.start == null && b.start == null) return 0;
    if (a.start == null) return 1;
    if (b.start == null) return -1;
    return a.start - b.start;
  });
  state.currentSegment = Math.max(0, state.segments.indexOf(cur));
}

// Apply already-read content as the active segment file.
async function segLoadContent(path, content, parsed) {
  let data = parsed;
  if (!data) { try { data = JSON.parse(content); } catch (e) { alert('That segment file is not valid JSON.'); return; } }
  const hasActiveVisuals = Object.values(state.visible).some(v => v);
  const keepVisuals = hasActiveVisuals && await window.api.confirmKeep(
    'You have active visual settings (scale, Fit L, eye, horizon…).\n\nKeep your current visuals and only load segment data from the file?'
  );
  try { segApplyData(data, keepVisuals); } catch (e) { /* non-fatal: still register the file */ }
  // Always ensure buttons and pose are in sync, even if segApplyData partially failed.
  updateComputeBtns();
  if (state.poseEnabled) schedulePose();
  state.currentSegment = (data && Number.isInteger(data.currentSegment)) ? Math.min(data.currentSegment, Math.max(0, state.segments.length - 1)) : 0;
  segSetActive(segBaseName(path), path);
  drawBothOverlays(); updateStepButtonStates(); updatePointPanel();
  // A layout shift (panel/scrollbar content) can resize+clear the primary canvas
  // right after we paint, leaving the view blank until a tool click. Repaint the
  // primary view (video + overlay) on the next frame, after layout settles.
  updateBladeSubMarkBtns(); segRenderPanel();
  requestAnimationFrame(() => {
    if (state.primary.ready) drawFrame(state.primary);
    drawOverlay('primary'); drawSegBars(); refreshExportJump();
  });
}

// Open a segment JSON from anywhere on disk (portable between users).
async function segOpenFile() {
  if (state.segFile && !confirm(SEG_WARN + '\n\nOpen another file?')) return;
  const res = await window.api.segLoad();
  if (!res) return;
  await segLoadContent(res.path, res.content, null);
}

function segSuggestedName() {
  const subj = localStorage.getItem('omsni-xl-subj') || '1';
  return `subj${subj}.json`;
}

async function segNewFile() {
  if (state.segFile && !confirm(SEG_WARN + '\n\nCreate a new file?')) return;
  // Fresh segments, but capture the current visual points into the new file.
  state.segments = []; state.segExcluded = []; state.bladeExcluded = []; state.eyeExcluded = []; state.exportMarks = []; state.exportDefs = {}; state.poseCache = {}; state.currentSegment = 0;
  const path = await window.api.segCreate(JSON.stringify(segBuildData(), null, 2), segSuggestedName());
  if (!path) return;
  segSetActive(segBaseName(path), path);
}

// Save As: write the current data to a new location and make it active.
async function segSaveAs() {
  const path = await window.api.segCreate(JSON.stringify(segBuildData(), null, 2), segSuggestedName());
  if (!path) return false;
  segSetActive(segBaseName(path), path);
  return true;
}

// Atomic save to the active file (manual button + debounced auto-save hook).
let _segSaveTimer = null;
function segSaveActive() {
  if (!state.segFile) return false;
  window.api.segWrite(state.segFile.path, JSON.stringify(segBuildData(), null, 2));
  return true;
}
function segScheduleSave() {       // Part B wires this to add/delete/compute/export
  if (!state.segFile) return;
  clearTimeout(_segSaveTimer);
  _segSaveTimer = setTimeout(segSaveActive, 400);
}

// Gate that forces an active file before saving-worthy actions (add segment /
// export). Returns true if usable, else shows the requirement and prompts.
function segRequireFile() {
  if (state.segFile) return true;
  alert(SEG_NEED);
  return false;
}

// ── Segments: mark/add/rename/delete/select ─────────────────────────────────
function segCurrent() { return state.segments[state.currentSegment] || null; }
let _segStart = null, _segEnd = null;
function updateMarkBtns() {
  const sb = $('btn-seg-start'), eb = $('btn-seg-end');
  if (sb) sb.textContent = _segStart == null ? '⟦ Start' : `⟦ Start ${_segStart}`;
  if (eb) eb.textContent = _segEnd == null ? 'End ⟧' : `End ${_segEnd} ⟧`;
}
function markSegStart() { _segStart = state.frame; updateMarkBtns(); }
function markSegEnd()   { _segEnd   = state.frame; updateMarkBtns(); }

function addSegment() {
  if (_segStart == null || _segEnd == null) { alert('Mark a Start and an End frame first.'); return; }
  if (!segRequireFile()) return;                       // first add with no file → Part-A requirement
  const s = Math.min(_segStart, _segEnd), e = Math.max(_segStart, _segEnd);
  const _newSeg = { name: 'Segment', start: s, end: e, computed: false, stats: null, warnings: [], _data: {} };
  state.segments.push(_newSeg);
  sortSegments();
  state.currentSegment = state.segments.indexOf(_newSeg);
  _segStart = _segEnd = null; updateMarkBtns();
  segRefreshSegDropdown(); segRenderPanel(); drawSegBars(); updateComputeBtns(); segScheduleSave();
}

function selectSegment(i) {
  if (i < 0 || i >= state.segments.length) return;
  state.currentSegment = i;
  // Picking a different segment drops any paused play/compute so the next
  // Play/Compute starts on THIS segment (not the previously paused one).
  if (!state.compute.running) state.compute = { running: false, paused: false, mode: null, segIdx: -1, frame: null };
  // Sync the Sub Start/Sub End button labels to THIS segment's own blade
  // subsegment (reads segCurrent() fresh, so no stale carry-over).
  updateBladeSubMarkBtns?.();
  restoreSegActiveBlade();   // #1: switch to this segment's stored blade, if any
  segRefreshSegDropdown(); segRenderPanel(); drawSegBars(); updateComputeBtns();
}

function deleteSegment(i) {
  const seg = state.segments[i]; if (!seg) return;
  if (!confirm('Delete ' + (seg.name || ('Segment ' + (i + 1))) + '?')) return;
  if (seg.start != null && seg.end != null)            // drop its fine-tuned poses
    for (let F = seg.start; F <= seg.end; F++) delete state.poseCache[F];
  state.segments.splice(i, 1);
  if (state.currentSegment >= state.segments.length) state.currentSegment = Math.max(0, state.segments.length - 1);
  segRefreshSegDropdown(); segRenderPanel(); drawSegBars(); updateComputeBtns(); segScheduleSave();
}

// ── Per-frame hip angles for stats ──────────────────────────────────────────
function hipAnglesForLandmarks(lms, rect) {
  const asg = poseSideAssignment(lms, rect);
  const aI = poseChainInfo(lms, rect, 11, 23, 25), bI = poseChainInfo(lms, rect, 12, 24, 26);
  const byside = {}; byside[asg.A] = aI; byside[asg.B] = bI;
  const lowConf = POSE_KEY_IDX.some(idx => !poseUsable(lms, idx));
  const sd = info => info ? { deg: Math.round(info.arc.deg * 10000) / 10000, conf: info.confident } : null;
  return { L: sd(byside.L), R: sd(byside.R), lowConf };
}

const SEG_JUMP_DEG = 15;   // angle jump (vs neighbour) that flags a frame
function computeSegStats(seg) {
  const d = seg._data || {};
  const excl = new Set(state.segExcluded);
  const acc = { L: [], R: [] };
  for (const k in d) {
    const F = +k; if (excl.has(F)) continue;
    const a = d[k];
    for (const s of ['L', 'R']) if (a[s] && a[s].conf) acc[s].push({ frame: F, deg: a[s].deg });
  }
  const stat = arr => {
    if (!arr.length) return null;
    let mn = arr[0], mx = arr[0], sum = 0;
    for (const x of arr) { if (x.deg < mn.deg) mn = x; if (x.deg > mx.deg) mx = x; sum += x.deg; }
    const sorted = arr.slice().sort((a, b) => a.deg - b.deg);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1].deg + sorted[mid].deg) / 2 : sorted[mid].deg;
    return { min: mn.deg, max: mx.deg, rom: mx.deg - mn.deg, mean: sum / arr.length, median, minFrame: mn.frame, maxFrame: mx.frame, n: arr.length };
  };
  seg.stats = { L: stat(acc.L), R: stat(acc.R) };
}
function detectWarnings(seg) {
  const d = seg._data || {};
  const frames = Object.keys(d).map(Number).sort((a, b) => a - b);
  const warn = new Set();
  for (let k = 0; k < frames.length; k++) {
    const a = d[frames[k]];
    if (a.lowConf) warn.add(frames[k]);
    if (k > 0) {
      const p = d[frames[k - 1]];
      for (const s of ['L', 'R'])
        if (a[s] && p[s] && a[s].conf && p[s].conf && Math.abs(a[s].deg - p[s].deg) > SEG_JUMP_DEG) warn.add(frames[k]);
    }
  }
  seg.warnings = [...warn].sort((a, b) => a - b);
}

// ── Blade subsegment reporting ───────────────────────────────────────────────
// Blade angle stats need the horizon (the "a" value is always reported relative
// to it) — base/displacement stats do NOT. Called once, up front, before
// anything starts computing:
//  - horizon placed but hidden → turn it back on AND sync the Horizon button's
//    UI state (updateStepButtonStates — a prior version only updated internal
//    state/drawing, not the button, so it looked like nothing happened).
//  - no horizon at all → warn immediately (not mid-compute) but do NOT abort;
//    base/displacement stats are still computed, only angleDeg stays null.
function ensureHorizonForBladeCompute() {
  // "Exists" includes a SAVED default horizon (same fallback the Place Horizon
  // button uses) — pull it in if none is set this session.
  if (!(state.horizon && state.horizon.p1 && state.horizon.p2)) {
    const def = (typeof loadSavedStateKey === 'function') ? loadSavedStateKey('horizon') : null;
    if (def && def.p1 && def.p2) state.horizon = def;
  }
  if (state.horizon && state.horizon.p1 && state.horizon.p2) {
    // Turn it ON and SHOW it every time (line + the Horizon button's lit/green
    // state) — even if it was already visible, re-assert so the icon reflects it.
    state.visible.horizon = true;
    updateStepButtonStates();
    drawBothOverlays();
    return true;
  }
  alert('No Horizon is set. Blade ANGLE statistics for this subsegment will be blank — base position / displacement stats will still be computed. Place a Horizon and Compute again for the angle stats.');
  return false;
}

// The TRUE joint (bend) position for a detected base+angle — handle-length away
// from base in the detected direction, exactly like getLFitJoint() derives it
// for the live Fit L (handleLen × videoPxPerCm × sizeMul is a GLOBAL constant,
// not per-frame, so this is valid for any frame during batch compute, not just
// the currently-displayed one). Returns null if no scale calibration exists yet
// (Set Scale not done) — distance stats then fall back to the base position.
function bladeJointFromBase(baseN, angleRad, dims) {
  const pxPerCm = state.scale?.videoPxPerCm || _bladeFitMemory?.videoPxPerCm || null;
  if (!pxPerCm || !state.template) return null;
  const sizeMul = _bladeFitMemory?.sizeMul || 1;
  const handleVP = state.template.handleLen * pxPerCm * sizeMul;
  return {
    x: baseN.x + Math.cos(angleRad) * handleVP / dims.w,
    y: baseN.y + Math.sin(angleRad) * handleVP / dims.h,
  };
}

// Find the two frames whose (joint) positions are FURTHEST APART (px). This is
// the outlier-finding metric: a stray/bad detection usually shows up as one of
// the two points at either end of this "furthest pair" — hyperlink to both so
// the user can jump to whichever one is wrong and Exclude it. O(n²) pairwise
// scan, capped by evenly subsampling very long ranges so it stays fast.
function _furthestPair(pts) {
  if (pts.length < 2) return null;
  let sample = pts;
  if (pts.length > 800) {
    const step = pts.length / 800;
    sample = [];
    for (let k = 0; k < 800; k++) sample.push(pts[Math.floor(k * step)]);
  }
  let bestA = null, bestB = null, bestD = -1;
  for (let a = 0; a < sample.length; a++) {
    for (let b = a + 1; b < sample.length; b++) {
      const d = Math.hypot(sample[a].x - sample[b].x, sample[a].y - sample[b].y);
      if (d > bestD) { bestD = d; bestA = sample[a]; bestB = sample[b]; }
    }
  }
  return bestA ? { a: bestA, b: bestB, distPx: bestD } : null;
}

// Blade stats for a segment's SUBSEGMENT range (defaults to the full segment if
// no subsegment was picked). Mirrors computeSegStats's angle math, plus a JOINT
// (bend-point) DISPLACEMENT in CENTIMETERS (via the Set Scale calibration, never
// raw pixels) between the two FURTHEST-APART tracked joint positions — the two
// frames most likely to include an outlier — with both frames exposed for
// hyperlinking. Excludes frames in state.bladeExcluded.
function computeBladeSubStats(seg) {
  if (!seg || !seg.bladeData) { seg.bladeStats = null; return; }
  let s0 = seg.bladeSubStart ?? seg.start, e0 = seg.bladeSubEnd ?? seg.end;
  if (s0 == null || e0 == null) { seg.bladeStats = null; return; }
  if (s0 > e0) [s0, e0] = [e0, s0];   // defensive: Sub Start marked after Sub End
  const excl = new Set(state.bladeExcluded || []);
  const dims = getNativeDims('primary');
  const rect = getVideoRect('primary');
  const pxPerCm = state.scale?.videoPxPerCm || null;
  const angles = [];
  const pts = [];   // {frame, x, y} pixel-space (JOINT position), for the furthest-pair scan
  for (let F = s0; F <= e0; F++) {
    if (excl.has(F)) continue;
    const d = seg.bladeData[F];
    if (!d || !d.base) continue;
    // Angle is derived from the STORED RAW angle against the CURRENT horizon —
    // not a value frozen at compute time — so moving the horizon after
    // Computing updates the angle stats without re-running any ML inference.
    const deg = (d.angle != null && rect) ? handleAngleToHorizonDeg(d.angle, rect) : null;
    if (deg != null) angles.push({ frame: F, deg });
    // Prefer the JOINT (bend point) for distance — falls back to base for older
    // saved data computed before this field existed, or if Set Scale wasn't
    // done at compute time (no handle length to project the joint out to).
    const dp = d.joint || d.base;
    if (dims) pts.push({ frame: F, x: dp.x * dims.w, y: dp.y * dims.h });
  }
  let angleStat = { n: 0 };
  if (angles.length) {
    let mn = angles[0], mx = angles[0], sum = 0;
    for (const a of angles) { if (a.deg < mn.deg) mn = a; if (a.deg > mx.deg) mx = a; sum += a.deg; }
    const sorted = angles.slice().sort((a, b) => a.deg - b.deg);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1].deg + sorted[mid].deg) / 2 : sorted[mid].deg;
    angleStat = { min: mn.deg, max: mx.deg, rom: mx.deg - mn.deg, mean: sum / angles.length, median,
                  minFrame: mn.frame, maxFrame: mx.frame, n: angles.length };
  }
  let dispCm = null, dispFrameA = null, dispFrameB = null;
  if (pxPerCm) {
    const fp = _furthestPair(pts);
    if (fp) { dispCm = fp.distPx / pxPerCm; dispFrameA = fp.a.frame; dispFrameB = fp.b.frame; }
  }
  // ── Eye subsegment stats (only where a tracked eye AND joint exist) ─────────
  // Same subsegment [s0,e0] as the blade (per request). c = eye↔joint↔horizon
  // angle; dist = eye↔joint distance (cm). Honors state.eyeExcluded.
  const eyeExcl = new Set(state.eyeExcluded || []);
  const cArr = [], dArr = [];
  for (let F = s0; F <= e0; F++) {
    if (eyeExcl.has(F)) continue;
    const d = seg.bladeData[F];
    if (!d || !d.eye || !d.joint) continue;
    const c = (rect) ? eyeJointHorizonDeg(d.eye, d.joint, rect) : null;
    if (c != null) cArr.push({ frame: F, v: c });
    if (dims && pxPerCm) {
      const dcm = Math.hypot((d.eye.x - d.joint.x) * dims.w, (d.eye.y - d.joint.y) * dims.h) / pxPerCm;
      dArr.push({ frame: F, v: dcm });
    }
  }
  const _stat = (arr) => {
    if (!arr.length) return { n: 0 };
    let mn = arr[0], mx = arr[0], sum = 0;
    for (const a of arr) { if (a.v < mn.v) mn = a; if (a.v > mx.v) mx = a; sum += a.v; }
    const sorted = arr.slice().sort((a, b) => a.v - b.v), mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1].v + sorted[mid].v) / 2 : sorted[mid].v;
    return { min: mn.v, max: mx.v, rom: mx.v - mn.v, mean: sum / arr.length, median,
             minFrame: mn.frame, maxFrame: mx.frame, n: arr.length };
  };
  const eyeStat = (cArr.length || dArr.length)
    ? { c: _stat(cArr), dist: _stat(dArr), n: Math.max(cArr.length, dArr.length) } : null;
  seg.bladeStats = { ...angleStat, dispCm, dispFrameA, dispFrameB, subStart: s0, subEnd: e0, eye: eyeStat };
}

// Open the Segments panel if it's currently collapsed (it's hidden by default
// until the user clicks "Segments ▾") — several blade actions (Compute finishing,
// Exclude) show their result THERE, so open it automatically rather than have
// the result silently update behind a closed panel.
function openSegPanel() {
  const p = $('seg-panel'); if (!p) return;
  if (p.classList.contains('hidden')) {
    p.classList.remove('hidden');
    $('btn-seg-panel')?.classList.add('active');
  }
}

// Exclude the CURRENT frame from blade subsegment stats (mirrors excludeCurrentFrame
// for pose, but a SEPARATE list — the blade signal is different from hip angles).
function excludeCurrentFrameBlade() {
  const F = state.frame;
  if (!state.bladeExcluded.includes(F)) state.bladeExcluded.push(F);
  const seg = segCurrent();
  if (seg && seg.bladeData) computeBladeSubStats(seg);
  openSegPanel();
  // Auto-expand this segment's blade stats so the updated min/max/furthest-pair
  // hyperlinks are immediately visible — the whole point of excluding a frame
  // is to see where the NEXT outlier candidate moved to.
  state._bladeStatsExpandedIdx = state.currentSegment;
  segRenderPanel(); drawSegBars(); segScheduleSave();
}

// ── Blade subsegment marking (Sub Start / Sub End) ──────────────────────────
// Writes onto the CURRENT segment's bladeSubStart/bladeSubEnd (a range WITHIN
// that segment). Each button commits IMMEDIATELY and INDEPENDENTLY — marking
// only Sub Start (never Sub End) is a complete, valid selection: the missing
// side simply defaults to the segment's own start/end everywhere it's read
// (computeBladeSubStats, runComputeLoop). Clamped to [seg.start, seg.end];
// if both ends are set out of order, they're swapped wherever read. The button
// labels themselves ("Sub Start: 42") are the only readout — no separate
// hyperlink display in the dropdown (redundant with the labels).
function updateBladeSubMarkBtns() {
  const seg = segCurrent();
  const sb = $('btn-blade-sub-start'), eb = $('btn-blade-sub-end');
  if (sb) sb.textContent = (seg?.bladeSubStart == null) ? 'Sub Start' : `Sub Start: ${seg.bladeSubStart}`;
  if (eb) eb.textContent = (seg?.bladeSubEnd == null) ? 'Sub End' : `Sub End: ${seg.bladeSubEnd}`;
}
// Re-derive stats from whatever's already in seg.bladeData for the NEW
// subsegment range, immediately — no need to wait for a fresh Compute. If the
// new range extends beyond what's been computed, those frames just show n=0
// until Compute fills them in (correct, not a bug).
function _refreshBladeSubStatsIfAny(seg) {
  if (seg && seg.bladeData) computeBladeSubStats(seg);
}
function markBladeSubStart() {
  const seg = segCurrent();
  if (!seg || seg.start == null || seg.end == null) { alert('Select a segment (with Start/End) first.'); return; }
  seg.bladeSubStart = Math.max(seg.start, Math.min(state.frame, seg.end));
  updateBladeSubMarkBtns(); _refreshBladeSubStatsIfAny(seg);
  segRenderPanel(); drawSegBars(); segScheduleSave();
}
function markBladeSubEnd() {
  const seg = segCurrent();
  if (!seg || seg.start == null || seg.end == null) { alert('Select a segment (with Start/End) first.'); return; }
  seg.bladeSubEnd = Math.max(seg.start, Math.min(state.frame, seg.end));
  updateBladeSubMarkBtns(); _refreshBladeSubStatsIfAny(seg);
  segRenderPanel(); drawSegBars(); segScheduleSave();
}
function clearBladeSub() {
  const seg = segCurrent(); if (!seg) return;
  seg.bladeSubStart = null; seg.bladeSubEnd = null;
  updateBladeSubMarkBtns(); _refreshBladeSubStatsIfAny(seg);
  segRenderPanel(); drawSegBars(); segScheduleSave();
}

// ── Buffering UI helpers ─────────────────────────────────────────────────────
function showBufferingLabel(text) {
  const el = $('buffering-label');
  if (el) { el.textContent = text; el.style.display = 'block'; }
}
function hideBufferingLabel() {
  const el = $('buffering-label');
  if (el) el.style.display = 'none';
}
function setBufferBar(pct) {   // left half = pose
  const bar = $('buffer-bar'), fill = $('buffer-bar-fill');
  if (bar) bar.style.display = 'flex';
  if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
}
function setBladeBufferBar(pct) {   // right half = blade warm-start
  const bar = $('buffer-bar'), fill = $('buffer-bar-fill-blade');
  if (bar) bar.style.display = 'flex';
  if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
}
function hideBufferBar() {
  const bar = $('buffer-bar'), fill = $('buffer-bar-fill'), bfill = $('buffer-bar-fill-blade');
  if (bar) bar.style.display = 'none';
  if (fill) fill.style.width = '0%';
  if (bfill) bfill.style.width = '0%';
}
// Blade's OWN progress feedback — a top-RIGHT overlay label on the primary video
// (mirrors pose's top-LEFT #buffering-label) + the blue (right) half of the split
// buffer bar. It used to be a badge in the Blade Tracker TOOLBAR group, which
// shifted the toolbar row and messed the view; moving it onto the video keeps the
// toolbar stable. Deliberately does NOT touch #buffering-label or the pose
// (left/orange) bar half, so blade and pose can show progress SIMULTANEOUSLY.
// pct (0-100) fills the blue bar half; omit it for an indeterminate step (warm-up).
function showBladeProgress(text, pct) {
  const el = $('blade-buffering-label');
  if (el) { el.textContent = text; el.style.display = 'block'; }
  if (pct != null) setBladeBufferBar(pct);
}
function hideBladeProgress() {
  const el = $('blade-buffering-label');
  if (el) el.style.display = 'none';
  const bar = $('buffer-bar'), bfill = $('buffer-bar-fill-blade');
  if (bfill) bfill.style.width = '0%';
  // Only hide the whole bar if pose's half is ALSO idle (0-width/hidden) — don't
  // yank the bar out from under a still-running pose compute.
  const pfill = $('buffer-bar-fill');
  if (bar && (!pfill || pfill.style.width === '0%' || pfill.style.width === '')) bar.style.display = 'none';
}

// Silent off-screen buffer step: seek the sampler to F, run detection, cache result.
// Does NOT update state.frame or the visible slider. Falls back to primary if no sampler.
async function _bufferStep(F, sampler) {
  let img;
  if (sampler) { await _seekSampler(sampler, F); img = sampler.el; }
  else { await awaitMainFrame(F); img = state.primary.el; }
  const N = Math.max(1, state.poseSmooth);
  const key = _poseKey(F, N);
  let tracked = null;
  try { tracked = await window.PoseEngine.detectForVideo(_roiImg(img), _computeTs()); } catch (e) {}
  const lms = _remapROI(_toArr(tracked));
  // Only write cache if not already present (same video, same N, deterministic result).
  if (lms && !state.poseDetCache.has(key)) poseDetCachePut(F, N, lms);
}

// ── Compute engine ──────────────────────────────────────────────────────────
function awaitMainFrame(F) {
  return new Promise(resolve => {
    const vs = state.primary;
    if (!vs.el) return resolve();
    let done = false;
    const fin = () => { if (done) return; done = true; vs.el.removeEventListener('seeked', fin); resolve(); };
    vs.el.addEventListener('seeked', fin);
    try { vs.el.currentTime = F / (vs.fps || 30); } catch (e) { fin(); }
    setTimeout(fin, 2500);   // safety (no seeked if already at F)
  });
}

// Per-compute-run monotonic timestamp counter — reset once per run so the
// sequential feed sees strictly-increasing timestamps on the fresh landmarker.
let _cTs = 0;
function _computeTs() { _cTs += 33; return _cTs; }

async function computeStep(F) {
  state.frame = F;
  updateSliderAndLabel('primary', F);
  if (state.secondary.ready) { updateSliderAndLabel('secondary', F); seekTo(state.secondary, F); }
  await awaitMainFrame(F);
  let tracked = null;
  try { tracked = await window.PoseEngine.detectForVideo(_roiImg(state.primary.el), _computeTs()); } catch (e) {}
  const edited = !!state.poseCache[F];
  const lms = edited ? state.poseCache[F] : _remapROI(_toArr(tracked));
  const N = Math.max(1, state.poseSmooth);
  if (!edited && lms) poseDetCachePut(F, N, lms);
  state.poseCurrent = { frame: F, landmarks: lms, edited };
  drawOverlay('primary'); updatePoseReadout();
}

// btn-seg-compute-all is labeled "Compute" — computes the SELECTED segment.
function updateComputeAllBtn() {
  const b = $('btn-seg-compute-all'); if (!b) return;
  const seg = segCurrent();
  const can = seg && seg.start != null && seg.end != null;
  b.disabled = !can && !state.compute.running;
  b.textContent = (state.compute.running && state.compute.mode === 'all')
    ? 'Pause' : (state.compute.paused && state.compute.mode === 'all' ? 'Resume' : 'Compute');
}
// btn-seg-compute is labeled "▶ Play / ⏸ Pause" — general live pose playback.
function updatePlayBtn() {
  const b = $('btn-seg-compute'); if (!b) return;
  b.disabled = !state.primary.ready;
  const isPlay = state.compute.running && (state.compute.mode === 'play' || state.compute.mode === 'audio-play');
  b.textContent = isPlay ? '⏸ Pause' : '▶ Play';
}

// If the user manually changes speed away from 1x while audio is active, turn audio off.
function updateAudioToggleState() {
  const btn = $('btn-audio-toggle'); if (!btn) return;
  const speedVal = parseFloat($('play-speed')?.value ?? '1');
  if (speedVal !== 1 && state.audioEnabled) {
    state.audioEnabled = false;
    btn.classList.remove('active');
    if (state.primary.el) state.primary.el.muted = true;
  }
}

// RVFC-based audio play: the video element plays natively (with audio unmuted).
// Pose detection is best-effort — each frame attempts detection, but if the
// previous call hasn't resolved yet it is silently skipped so audio never pauses.
async function runAudioPlayLoop(from, end) {
  const vs = state.primary;
  if (!vs.el) {
    state.compute = { running: false, paused: false, mode: null, segIdx: -1, frame: null };
    updateComputeBtns(); return;
  }
  vs.el.muted = false;
  vs.el.currentTime = from / (vs.fps || 30);

  let poseInFlight = false;

  await new Promise((resolve) => {
    let lastMediaTime = -1;

    const onRVFC = (now, meta) => {
      if (!state.compute.running || state.compute.mode !== 'audio-play') {
        vs.el.pause(); vs.el.muted = true; resolve(); return;
      }
      // Detect user seek: unexpected jump in mediaTime between RVFC ticks
      if (lastMediaTime >= 0) {
        const dt = meta.mediaTime - lastMediaTime;
        if (dt > 2.0 || dt < -0.1) {
          lastMediaTime = meta.mediaTime;
          vs.el.pause(); vs.el.muted = true;
          resolve();
          state.compute = { running: false, paused: false, mode: null, segIdx: -1, frame: null };
          updateComputeBtns();
          setTimeout(togglePlay, 100);
          return;
        }
      }
      lastMediaTime = meta.mediaTime;
      const fps = vs.fps || 30;
      const F = Math.round(meta.mediaTime * fps);
      state.frame = F;
      updateSliderAndLabel('primary', F);
      if (state.secondary.ready) { updateSliderAndLabel('secondary', F); seekTo(state.secondary, F); }

      // Paint the current video frame onto the canvas each tick
      drawFrame(vs);

      // Cache-first pose: use pre-buffered data, fall back to best-effort detection
      if (state.poseEnabled) {
        const _N = Math.max(1, state.poseSmooth);
        const ck = _poseKey(F, _N);
        if (state.poseCache[F]) {
          state.poseCurrent = { frame: F, landmarks: state.poseCache[F], edited: true };
          drawOverlay('primary'); updatePoseReadout();
        } else if (state.poseDetCache.has(ck)) {
          const lms = state.poseDetCache.get(ck);
          if (lms) { state.poseCurrent = { frame: F, landmarks: lms, edited: false }; drawOverlay('primary'); updatePoseReadout(); }
        } else if (!poseInFlight && window.PoseEngine && vs.el.readyState >= 2) {
          poseInFlight = true;
          const ts = Math.round(meta.mediaTime * 1000);
          // Safety timeout: reset poseInFlight if detection hangs (e.g. ROI blocked by nurse)
          const _pifTimer = setTimeout(() => { poseInFlight = false; }, 3000);
          window.PoseEngine.detectForVideo(_roiImg(vs.el), ts).then(res => {
            clearTimeout(_pifTimer); poseInFlight = false;
            const lms = _remapROI(_toArr(res));
            if (lms && state.frame === F) {
              poseDetCachePut(F, _N, lms);
              state.poseCurrent = { frame: F, landmarks: lms, edited: false };
              drawOverlay('primary'); updatePoseReadout();
            }
          }).catch(() => { clearTimeout(_pifTimer); poseInFlight = false; });
        }
      }

      // Best-effort blade tracking during audio playback (fire-and-forget).
      bladeTrackDuringPlay();

      if (F >= end) {
        vs.el.pause(); vs.el.muted = true;
        state.compute = { running: false, paused: false, mode: null, segIdx: -1, frame: null };
        updateComputeBtns(); resolve(); return;
      }

      vs.el.requestVideoFrameCallback(onRVFC);
    };

    vs.el.requestVideoFrameCallback(onRVFC);
    vs.el.play().catch(err => {
      vs.el.muted = true;
      state.compute = { running: false, paused: false, mode: null, segIdx: -1, frame: null };
      updateComputeBtns(); resolve();
    });
  });
}

function updateComputeBtns() { updateComputeAllBtn(); updatePlayBtn(); updateAudioToggleState(); }

async function ensurePoseRunReady() {
  if (!window.PoseEngine) { alert('Pose engine not ready yet — toggle Pose on once, then retry.'); return false; }
  await window.PoseEngine.warmup();
  state.poseEnabled = true; $('btn-pose')?.classList.add('active');
  return true;
}

// Walk [start..end] for one segment, recording per-frame angles + stats.
async function runComputeLoop(i, fromFrame) {
  const seg = state.segments[i]; if (!seg) return true;
  if (!seg._data) seg._data = {};
  const N = Math.max(1, state.poseSmooth);
  state.compute = { running: true, paused: false, mode: 'all', segIdx: i, frame: fromFrame };
  updateComputeBtns();
  // Reset after marking running so a throw here leaves the button in a stoppable state.
  _cTs = 0; try { await window.PoseEngine.reset(); } catch (e) {}

  // Blade setup — ONLY when the tracker is on; every line below gated on
  // bladeCtx is new, so with the tracker off this is the ORIGINAL pose-only
  // loop, unchanged. Blade runs INLINE, one step per frame, right after pose's
  // own step for that SAME frame — no separate sampler, no separate pacing, no
  // separate progress loop: "like pose, all together". The expensive blade step
  // (ONNX inference) only runs for frames INSIDE the chosen subsegment (pose
  // still walks the whole segment regardless, for hip stats) — narrowing the
  // subsegment to the interesting part keeps Compute fast.
  let bladeCtx = null;
  if (state.bladeTrackerEnabled && state.template
      && (state.activeTemplate === 1 || state.activeTemplate === 2 || state.activeTemplate === 3)) {
    const dims = getNativeDims('primary');
    if (dims) {
      if (!seg.bladeData) seg.bladeData = {};
      resetBladeTracker();
      let bs0 = seg.bladeSubStart ?? seg.start, be0 = seg.bladeSubEnd ?? seg.end;
      if (bs0 > be0) [bs0, be0] = [be0, bs0];
      // Warm-up lead-in: run the blade pipeline (no store, no draw) for the N
      // frames BEFORE the subsegment so the smoother is already warm at s0. Cold
      // smoother history was why Compute's blade looked bad ("terrible until the
      // subsegment start") while Play — pre-warmed by the warm-start buffer — did
      // not. Floor at 0; the loop itself never steps below warmStart, so this
      // reuses the pose warm-up frames as extra blade lead when bs0 is near the
      // segment start.
      const w0 = Math.max(0, bs0 - (N - 1));
      bladeCtx = { blade: state.activeTemplate, roi: state.bladeRoi || { x: 0, y: 0, w: 1, h: 1 }, dims, s0: bs0, e0: be0, w0 };
    }
  }

  const warmStart = Math.max(0, fromFrame - (N - 1));
  const warmTotal = Math.max(1, fromFrame - warmStart);
  const bladeTotal = bladeCtx ? Math.max(1, bladeCtx.e0 - bladeCtx.s0 + 1) : 1;
  let _warmupDone = warmStart >= fromFrame;
  if (!_warmupDone) { showBufferingLabel('Warming up…'); setBufferBar(0); }
  for (let F = warmStart; F <= seg.end; F++) {
    if (state.compute.paused || !state.compute.running) {
      hideBufferingLabel(); hideBufferBar(); if (bladeCtx) hideBladeProgress();
      state.compute.frame = Math.max(F, seg.start); updateComputeBtns(); segRenderPanel(); return false;
    }
    if (!_warmupDone && F >= fromFrame) { _warmupDone = true; hideBufferingLabel(); hideBufferBar(); }
    if (!_warmupDone) setBufferBar(Math.round((F - warmStart) / warmTotal * 100));
    await computeStep(F);
    if (F >= seg.start && state.poseCurrent?.landmarks) {
      seg._data[F] = hipAnglesForLandmarks(state.poseCurrent.landmarks, getVideoRect('primary'));
      seg._data[F].lm = state.poseCurrent.landmarks;   // temp — pruned to key frames below
    }
    // Blade step on the frame pose JUST displayed — always in sync with what's
    // on screen. Runs across [w0 … e0]: the [w0 … s0-1] lead-in only WARMS the
    // smoother (no store, no draw), and [s0 … e0] (the chosen subsegment) stores
    // + draws. Pose still walks the whole segment either way, for hip stats.
    // fast=true (single inference pass, same mode ▶ Play uses): temporal
    // smoothing across frames processed strictly in order does the noise-
    // averaging instead of a costly 2nd refine pass every frame.
    if (bladeCtx && F >= bladeCtx.w0 && F <= bladeCtx.e0) {
      const inSub = F >= bladeCtx.s0;
      if (inSub) { const p = Math.round((F - bladeCtx.s0 + 1) / bladeTotal * 100); showBladeProgress(`Blade ${p}%`, p); }
      else showBladeProgress('Blade warm-up…');
      let out = { none: true };
      try { out = await bladeDetectAndSmooth(state.primary.el, bladeCtx.roi, bladeCtx.dims, bladeCtx.blade, true); } catch (e) {}
      if (inSub) {
        if (out.res) {
          seg.bladeData[F] = {
            base: out.res.baseN, joint: bladeJointFromBase(out.res.baseN, out.res.angle, bladeCtx.dims),
            angle: out.res.angle, conf: out.res.conf,
          };
          // Eye tracker on → store the pose-reconstructed red eye for this frame
          // so the eye subsegment stats (c-angle, eye↔joint distance) can be built.
          if (state.eyeTrackerEnabled && state.poseCurrent?.landmarks) {
            const _e = eyeFromPose(state.poseCurrent.landmarks, bladeCtx.dims);
            if (_e) seg.bladeData[F].eye = _e;
          }
          applyBladeResult(out.res, bladeCtx.dims, 'lite');
        } else if (!out.reject) {
          // No blade this frame (genuine miss, not a fast-mode outlier hold):
          // remove the stale Fit L NOW so it disappears mid-Compute, matching
          // Play — don't leave the previous frame's L drawn.
          seg.bladeData[F] = null;
          clearBladeFit(false); drawOverlay('primary');
        }
      }
    }
    state.compute.frame = F + 1;
  }
  hideBufferingLabel(); hideBufferBar(); if (bladeCtx) hideBladeProgress();
  computeSegStats(seg); detectWarnings(seg); seg.computed = true;
  // Keep .lm only on the 4 key frames (L/R min+max) to stay small in the JSON file.
  const _keyF = new Set();
  for (const side of ['L', 'R']) {
    if (seg.stats[side]?.minFrame != null) _keyF.add(seg.stats[side].minFrame);
    if (seg.stats[side]?.maxFrame != null) _keyF.add(seg.stats[side].maxFrame);
  }
  for (const k in seg._data) {
    if (_keyF.has(+k)) { seg._data[k].lmN = N; }
    else { delete seg._data[k].lm; delete seg._data[k].lmN; }
  }
  if (bladeCtx) {
    computeBladeSubStats(seg);
    state._bladeStatsExpandedIdx = i;
    openSegPanel();
    // One full UI sync now that the tight loop is done (button states + fine-
    // tune panel) — during the loop only the cheap 'lite' draw ran per frame.
    if (typeof updateStepButtonStates === 'function') updateStepButtonStates();
    updatePointPanel();
  }
  return true;
}

// "Compute" button: compute the SELECTED segment (click again to pause/resume).
// When the blade tracker is on, blade runs INLINE inside runComputeLoop, one
// frame at a time, right alongside pose — genuinely "all together", not two
// independent passes. With the blade tracker off, this is exactly the original
// pose-only path (identical to before blade tracking existed).
async function onCompute() {
  if (state.compute.running && state.compute.mode === 'all') { state.compute.paused = true; state.compute.running = false; updateComputeBtns(); return; }
  const i = state.currentSegment, seg = state.segments[i];
  if (!seg || seg.start == null || seg.end == null) { alert('Select a segment that has a Start and End first.'); return; }
  const wantBlade = state.bladeTrackerEnabled && !!state.template;
  // #1: recomputing records the blade used on this segment (so re-open/select restores it).
  if (wantBlade && seg) seg.activeBlade = state.activeTemplate;
  // Horizon check happens FIRST, before Compute starts — so the warning (if
  // any) appears immediately, not buried mid-compute. Never blocks: base and
  // displacement stats don't need a horizon, only the angle stat does.
  if (wantBlade) ensureHorizonForBladeCompute();
  if (!(await ensurePoseRunReady())) return;
  const isResume = (state.compute.mode === 'all' && state.compute.paused && state.compute.segIdx === i && state.compute.frame != null);
  const from = isResume ? state.compute.frame : seg.start;
  if (!isResume) {
    // Fresh compute: clear any prior exclusions inside this segment so re-compute starts clean.
    state.segExcluded = (state.segExcluded || []).filter(F => F < seg.start || F > seg.end);
    if (wantBlade) state.bladeExcluded = (state.bladeExcluded || []).filter(F => F < seg.start || F > seg.end);
  }
  const done = await runComputeLoop(i, from);
  if (done) state.compute = { running: false, paused: false, mode: null, segIdx: -1, frame: null };
  updateComputeBtns(); segRenderPanel(); drawSegBars(); segScheduleSave();
  // Same disappearance logic as ▶ Play's pause: re-evaluate the parked frame with
  // the accurate detector so if there's no blade here (end of / mid Compute) the
  // stale Fit L is removed instead of lingering.
  if (state.bladeTrackerEnabled) setTimeout(() => scheduleBladeTrack(), 60);
}

// "▶ Play / ⏸ Pause": play the SELECTED segment's range with the live pose
// tracker; plays freely when Segments panel is collapsed or no segment is selected.
// Phase 1: silent pre-buffer (sampler, off-screen) fills poseDetCache for a window
//   [from-bufFrames … from+bufFrames] before any visible playback begins.
// Phase 2: plays from `from` using cache-first lookup + frame-rate enforcement.
async function togglePlay() {
  if (state.compute.running) {
    state.compute.paused = true; state.compute.running = false;
    hideBufferingLabel(); hideBufferBar();
    if (state.compute.mode === 'audio-play' && state.primary.el) {
      state.primary.el.pause(); state.primary.el.muted = true;
    }
    updateComputeBtns();
    // Recompute the parked frame with the accurate (2-pass) path so a frame's
    // result never depends on whether you reached it by playing vs. scrubbing.
    if (state.bladeTrackerEnabled) setTimeout(() => scheduleBladeTrack(), 60);
    return;
  }
  if (!(await ensurePoseRunReady())) return;
  if (state.template) enableBladeTracker();   // ▶ Play turns on blade tracking too
  const seg = segCurrent();
  const segPanelOpen = $('btn-seg-panel')?.classList.contains('active');
  const hasSeg = segPanelOpen && seg && seg.start != null && seg.end != null;
  const resume = segPanelOpen && state.compute.mode === 'play' && state.compute.paused && state.compute.frame != null
    && state.compute.segIdx === (hasSeg ? state.currentSegment : -1);
  const from = resume ? state.compute.frame : (hasSeg ? seg.start : state.frame);
  const end  = hasSeg ? seg.end : Math.max(0, (state.primary.totalFrames || 1) - 1);
  const N = Math.max(1, state.poseSmooth);
  const _useAudioPlay = state.audioEnabled && parseFloat($('play-speed')?.value ?? '1') === 1;
  state.compute = { running: true, paused: false, mode: _useAudioPlay ? 'audio-play' : 'play', segIdx: hasSeg ? state.currentSegment : -1, frame: from };
  updateComputeBtns();

  // Snap the current frame to the play START before either phase runs. Both
  // phases treat a large (state.frame − from) gap as a "user seeked away" event
  // and bail out + setTimeout(togglePlay) — so if you click Play with a segment
  // selected while parked elsewhere, that fired on the very first iteration and
  // restarted forever (the "play/pause repeatedly" bug). Clicking the segment's
  // start hyperlink first avoided it precisely because it moved state.frame to
  // the start. Do that move here so the button behaves the same way.
  if (!resume && state.frame !== from) { state.frame = from; updateSliderAndLabel('primary', from); }

  _cTs = 0; try { await window.PoseEngine.reset(); } catch (e) {}

  // ── Phase 1: silent pre-buffer (audio AND non-audio) ────────────────────────
  // Audio play now goes through the SAME pre-buffer as muted play (user request:
  // "have play do the exact same thing when audio is on … just wait for buffer
  // before showing all with audio"), then hands off to the audio RVFC loop below.
  const fps = state.primary.fps || 30;
  const bufSec = parseFloat($('buffer-sec')?.value ?? '3');
  const BUFFER_FRAMES = Math.round(bufSec * fps);
  const bufStart = Math.max(0, from - (N - 1));
  const bufEnd   = Math.min(end, from + BUFFER_FRAMES);
  const bufTotal = Math.max(1, bufEnd - bufStart + 1);

  const sampler = poseSamplerEl();
  if (sampler) await _samplerReady(sampler);

  // Blade warm-start runs CONCURRENTLY with the pose pre-buffer (own sampler +
  // main-process inference), so it adds no wall time. It only needs the LOOKBACK
  // window [bufStart … from] to warm the smoother up to the play-start frame.
  const bladeWarmPromise = state.bladeTrackerEnabled ? bladeWarmupBuffer(bufStart, from) : null;

  let bufDone = 0;
  for (let F = bufStart; F <= bufEnd; F++) {
    if (state.compute.paused || !state.compute.running) {
      hideBufferingLabel(); hideBufferBar(); state.compute.frame = from; updateComputeBtns(); return;
    }
    // Abort Phase 1 if user seeked to a different position during buffering
    if (Math.abs(state.frame - from) > 10) {
      state.compute = { running: false, paused: false, mode: null, segIdx: -1, frame: null };
      hideBufferingLabel(); hideBufferBar(); updateComputeBtns();
      setTimeout(togglePlay, 100); return;
    }
    const pct = Math.round(bufDone / bufTotal * 100);
    showBufferingLabel('Buffering… ' + pct + '%');
    setBufferBar(pct);
    const pbtn = $('btn-seg-compute'); if (pbtn) pbtn.textContent = 'Buffering… ' + pct + '%';
    await _bufferStep(F, sampler);
    bufDone++;
  }
  // Wait for the (concurrent) blade warm-start to finish before playback.
  if (bladeWarmPromise) {
    showBufferingLabel('Buffering…');
    try { await bladeWarmPromise; } catch (e) {}
    if (state.compute.paused || !state.compute.running) { hideBufferingLabel(); hideBufferBar(); state.compute.frame = from; updateComputeBtns(); return; }
  }
  hideBufferingLabel(); hideBufferBar();
  updateComputeBtns();   // resets button text to ⏸ Pause

  // Audio play: hand off to the native RVFC audio loop now that the buffer is
  // warm (it seeks the video to `from` and plays with sound).
  if (_useAudioPlay) { await runAudioPlayLoop(from, end); return; }

  // ── Phase 2: play with cache-first + frame-rate enforcement ──────────────
  const speedVal = parseFloat($('play-speed')?.value ?? '1');
  const targetFrameMs = (1000 / fps) / speedVal;

  for (let F = from; F <= end; F++) {
    if (state.compute.paused || !state.compute.running) {
      state.compute.frame = Math.max(F, from); updateComputeBtns(); return;
    }
    // Detect user seek (goToFrame fires during await yield and sets state.frame)
    if (Math.abs(state.frame - F) > 10) {
      state.compute = { running: false, paused: false, mode: null, segIdx: -1, frame: null };
      updateComputeBtns();
      setTimeout(togglePlay, 100);
      return;
    }
    const t0 = performance.now();
    const cacheKey = _poseKey(F, N);

    state.frame = F;
    updateSliderAndLabel('primary', F);
    if (state.secondary.ready) { updateSliderAndLabel('secondary', F); seekTo(state.secondary, F); }
    await awaitMainFrame(F);

    let lms;
    const edited = !!state.poseCache[F];
    if (edited) {
      lms = state.poseCache[F];
    } else if (state.poseDetCache.has(cacheKey)) {
      lms = state.poseDetCache.get(cacheKey);
    } else {
      // Beyond the buffer — run detection on the sequential tracker
      let tracked = null;
      try { tracked = await window.PoseEngine.detectForVideo(_roiImg(state.primary.el), _computeTs()); } catch (e) {}
      lms = _remapROI(_toArr(tracked));
      if (lms) poseDetCachePut(F, N, lms);
    }

    state.poseCurrent = { frame: F, landmarks: lms, edited };
    drawOverlay('primary'); updatePoseReadout();
    // Best-effort blade tracking during play (fire-and-forget; the in-flight
    // guard skips overlapping calls so playback never waits on inference).
    bladeTrackDuringPlay();
    state.segments.forEach(s => {
      if (s._data && s.start != null && F >= s.start && F <= s.end && state.poseCurrent?.landmarks)
        s._data[F] = hipAnglesForLandmarks(state.poseCurrent.landmarks, getVideoRect('primary'));
    });
    state.compute.frame = F + 1;

    // Enforce playback speed — only adds delay when the frame was faster than target
    const elapsed = performance.now() - t0;
    if (elapsed < targetFrameMs) await new Promise(r => setTimeout(r, targetFrameMs - elapsed));
  }
  state.compute = { running: false, paused: false, mode: null, segIdx: -1, frame: null };
  updateComputeBtns();
}

// ── Exclude / warnings ──────────────────────────────────────────────────────
function recomputeAffected(F) {
  state.segments.forEach(seg => { if (seg.start != null && F >= seg.start && F <= seg.end && seg._data) { computeSegStats(seg); detectWarnings(seg); } });
}
function excludeCurrentFrame() {
  const F = state.frame;
  if (!state.segExcluded.includes(F)) state.segExcluded.push(F);
  poseDetCacheInvalidateFrame(F);
  recomputeAffected(F);
  segRenderPanel(); drawSegBars(); drawOverlay('primary'); segScheduleSave();
}
function ignoreWarningFrames() {
  const seg = segCurrent(); if (!seg || !seg.warnings || !seg.warnings.length) return;
  for (const F of seg.warnings) if (!state.segExcluded.includes(F)) state.segExcluded.push(F);
  computeSegStats(seg); detectWarnings(seg);
  segRenderPanel(); drawSegBars(); segScheduleSave();
}
// Fine-tune of frame F → refresh any computed segment containing it.
function segOnFineTune(F) {
  const lms = state.poseCache[F]; if (!lms) return;
  const rect = getVideoRect('primary'); let changed = false;
  state.segments.forEach(seg => {
    if (seg.start != null && F >= seg.start && F <= seg.end && (seg.computed || (seg._data && seg._data[F] !== undefined))) {
      if (!seg._data) seg._data = {};
      seg._data[F] = hipAnglesForLandmarks(lms, rect);
      computeSegStats(seg); detectWarnings(seg); changed = true;
    }
  });
  if (changed) { segRenderPanel(); drawSegBars(); }
}
// #2: a Fit L fine-tune (drag base/joint/rotate) on a frame that already has
// computed blade data rewrites THAT frame's stored blade entry from the current
// Fit L, then re-derives the subsegment stats — so the JSON reflects the manual
// correction, exactly like segOnFineTune does for hip poses.
function bladeOnFineTune(F) {
  if (!state.lfit || !state.lfit.base) return;
  const dims = getNativeDims('primary'); if (!dims) return;
  const joint = (typeof getLFitJoint === 'function') ? getLFitJoint() : state.lfit.joint;
  if (!joint) return;
  const angle = Math.atan2((joint.y - state.lfit.base.y) * dims.h, (joint.x - state.lfit.base.x) * dims.w);
  let changed = false;
  for (const seg of state.segments) {
    if (seg.bladeData && Object.prototype.hasOwnProperty.call(seg.bladeData, F) && seg.bladeData[F]) {
      seg.bladeData[F] = {
        base: { x: state.lfit.base.x, y: state.lfit.base.y },
        joint: { x: joint.x, y: joint.y },
        angle, conf: (seg.bladeData[F].conf ?? 1), edited: true,
      };
      computeBladeSubStats(seg); changed = true;
    }
  }
  if (changed) { segRenderPanel(); drawSegBars(); drawOverlay('primary'); updatePointPanel(); segScheduleSave(); }
}

// Export marks on the scrollbar.
function exportFramePos(F) {
  const sorted = (state.exportMarks || []).slice().sort((a, b) => +a - +b);
  const idx = sorted.findIndex(m => +m === +F); return idx >= 0 ? idx + 1 : null;
}
function addExportMark(F) {
  if (!state.exportMarks.includes(F)) state.exportMarks.push(F);
  drawSegBars(); refreshExportJump(); segScheduleSave();
}
// Independent dropdown to jump to any Export-XLSX frame (the dots are small).
function refreshExportJump() {
  const s = $('export-jump'); if (!s) return;
  const marks = (state.exportMarks || []).slice().sort((a, b) => a - b);
  s.innerHTML = '<option value="">Export ▾</option>' + marks.map((f, i) => `<option value="${f}">#${i+1} @ frame ${f}</option>`).join('');
}

// ── Scrollbar bars + panel ──────────────────────────────────────────────────
function segVisible3() {
  const n = state.segments.length, cur = state.currentSegment;
  let lo = Math.max(0, cur - 1), hi = Math.min(n - 1, cur + 1);
  if (hi - lo < 2) { if (lo === 0) hi = Math.min(n - 1, 2); else lo = Math.max(0, n - 3); }
  const s = new Set(); for (let i = lo; i <= hi; i++) s.add(i); return s;
}
function drawSegBars() {
  const el = $('seg-bars'); if (!el) return;
  const tot = Math.max((state.primary.totalFrames || 1) - 1, 1);
  let html = '';
  const cur = state.currentSegment;
  const visible = segVisible3();
  state.segments.forEach((s, i) => {
    if (s.start == null || s.end == null) return;
    if (!visible.has(i)) return;
    const l = 100 * s.start / tot, r = 100 * s.end / tot, w = Math.max(0.6, r - l), mid = (l + r) / 2;
    html += `<div class="seg-bar${i === cur ? ' active' : ''}" style="left:${l}%;width:${w}%;" title="${s.name}"></div>`;
    html += `<div class="seg-num" style="left:${mid}%;">${i + 1}</div>`;
    // Blade subsegment range within this segment (thin blue overlay). Only one
    // side may be explicitly marked — the other defaults to the segment's own.
    if (i === cur && (s.bladeSubStart != null || s.bladeSubEnd != null)) {
      let bs = s.bladeSubStart ?? s.start, be = s.bladeSubEnd ?? s.end;
      if (bs > be) [bs, be] = [be, bs];
      const bl = 100 * bs / tot, br = 100 * be / tot, bw = Math.max(0.4, br - bl);
      html += `<div class="seg-bar-sub" style="left:${bl}%;width:${bw}%;" title="Blade subsegment [${bs}-${be}]"></div>`;
    }
  });
  for (const F of (state.segExcluded || [])) html += `<div class="seg-excl" style="left:${100 * F / tot}%;" title="Excluded frame ${F}"></div>`;
  for (const F of (state.bladeExcluded || [])) html += `<div class="seg-excl-blade" style="left:${100 * F / tot}%;" title="Blade-excluded frame ${F}"></div>`;
  for (const F of (state.exportMarks || [])) html += `<div class="seg-export" style="left:${100 * F / tot}%;" title="Export @ frame ${F}"></div>`;
  el.innerHTML = html;
}

function segRenderPanel() {
  const p = $('seg-panel'); if (!p) return;
  const fmt = v => v == null ? '—' : v.toFixed(1);
  if (!state.segments.length) { p.innerHTML = '<span style="color:#888">No segments yet. Mark ⟦ Start and End ⟧, then “+ Segment”.</span>'; return; }
  let html = '';
  const _vis = segVisible3();
  state.segments.forEach((s, i) => {
    if (!_vis.has(i)) return;
    html += `<div class="seg-row${i === state.currentSegment ? ' sel' : ''}">`;
    html += `<b>${i + 1}</b>`;
    html += `<input class="seg-name" data-i="${i}" value="${(s.name || '').replace(/"/g, '&quot;')}">`;
    html += `<span class="seg-stats">[${s.start != null ? `<a class="jump" data-f="${s.start}">${s.start}</a>` : '—'}–${s.end != null ? `<a class="jump" data-f="${s.end}">${s.end}</a>` : '—'}]</span>`;
    html += `<button data-act="sel" data-i="${i}">select</button>`;
    html += `<button data-act="del" data-i="${i}">×</button>`;
    if (s.stats) {
      for (const side of ['L', 'R']) {
        const st = s.stats[side];
        html += st
          ? `<span class="seg-stats">${side}: min <a class="jump" data-f="${st.minFrame}">${fmt(st.min)}°</a> max <a class="jump" data-f="${st.maxFrame}">${fmt(st.max)}°</a> ROM ${fmt(st.rom)}° (n${st.n})</span>`
          : `<span class="seg-stats">${side}: —</span>`;
      }
      if (s.start != null && s.end != null) {
        const _fps = state.primary?.fps || 30;
        const ms = (s.end - s.start) / _fps * 1000;
        const mn = Math.floor(ms / 60000), sc = Math.floor((ms % 60000) / 1000), ml = Math.round(ms % 1000);
        html += `<span class="seg-stats">Duration: ${mn}:${String(sc).padStart(2,'0')}.${String(ml).padStart(3,'0')}</span>`;
      }
    } else html += '<span class="seg-stats">(not computed)</span>';
    if (s.warnings && s.warnings.length) {
      html += `<span class="seg-warn">⚠ ${s.warnings.length} suspicious</span>`;
      if (i === state.currentSegment) html += `<button data-act="ignore" data-i="${i}">Ignore all</button>`;
    }
    // Blade subsegment: the RANGE is always shown once picked — before AND
    // after Compute, hyperlinked, exactly like the segment's own [start-end] —
    // with a small ▸/▾ toggle that expands full stats IN PLACE (this row grows,
    // no new row is added to the panel; collapsed by default for every segment
    // except the one currently expanded).
    // Show the blade row whenever a subsegment was marked OR blade stats exist
    // (a blade Compute with NO explicit subsegment still produces bladeStats over
    // the full segment — its min/max/furthest hyperlinks must be reachable so the
    // user can jump to and Exclude outlier frames).
    if (s.bladeSubStart != null || s.bladeSubEnd != null || (s.bladeStats && s.bladeStats.n)) {
      let bss = s.bladeSubStart ?? s.start, bse = s.bladeSubEnd ?? s.end;
      if (bss > bse) [bss, bse] = [bse, bss];
      const expanded = state._bladeStatsExpandedIdx === i;
      html += `<span class="seg-stats" style="color:#a5d8ff;">Blade sub [<a class="jump" data-f="${bss}">${bss}</a>–<a class="jump" data-f="${bse}">${bse}</a>]</span>`;
      html += `<button data-act="bladeToggle" data-i="${i}" style="font-size:10px;padding:1px 5px;">${expanded ? '▾' : '▸'}</button>`;
      if (expanded) {
        const bs = s.bladeStats;
        // Blade sub — min/max hyperlinked + ROM. Mean/median are Excel-only now.
        if (bs && bs.n) {
          html += `<span class="seg-stats" style="color:#a5d8ff;">Blade sub — min <a class="jump" data-f="${bs.minFrame}">${fmt(bs.min)}°</a> max <a class="jump" data-f="${bs.maxFrame}">${fmt(bs.max)}°</a> ROM ${fmt(bs.rom)}°</span>`;
        }
        if (bs && bs.dispCm != null) {
          // The two FURTHEST-APART tracked JOINT points — a likely outlier pair.
          // Jump to either and Exclude blade from that frame, then re-Compute.
          html += `<span class="seg-stats" style="color:#a5d8ff;">joint furthest <a class="jump" data-f="${bs.dispFrameA}">${bs.dispFrameA}</a>↔<a class="jump" data-f="${bs.dispFrameB}">${bs.dispFrameB}</a> = ${fromCm(bs.dispCm).toFixed(2)} ${state.units}</span>`;
        }
        // Eye — c-angle + eye↔joint distance, min/max hyperlinked (Excel has mean/median).
        if (bs && bs.eye) {
          const ec = bs.eye.c, ed = bs.eye.dist;
          if (ec && ec.n) html += `<span class="seg-stats" style="color:#ffd8a8;">Eye c — min <a class="jump" data-f="${ec.minFrame}">${fmt(ec.min)}°</a> max <a class="jump" data-f="${ec.maxFrame}">${fmt(ec.max)}°</a> ROM ${fmt(ec.rom)}°</span>`;
          if (ed && ed.n) html += `<span class="seg-stats" style="color:#ffd8a8;">Eye dist — min <a class="jump" data-f="${ed.minFrame}">${fromCm(ed.min).toFixed(2)}</a> max <a class="jump" data-f="${ed.maxFrame}">${fromCm(ed.max).toFixed(2)}</a> ${state.units}</span>`;
        }
        if (!bs || (!bs.n && bs.dispCm == null)) {
          html += `<span class="seg-stats" style="color:#888">(not computed yet — click Compute)</span>`;
        }
      }
    }
    html += '</div>';
  });
  p.innerHTML = html;
  p.querySelectorAll('.seg-name').forEach(inp => inp.addEventListener('change', e => {
    const i = +e.target.dataset.i; state.segments[i].name = e.target.value || ('Segment ' + (i + 1));
    segRefreshSegDropdown(); drawSegBars(); segScheduleSave();
  }));
  p.querySelectorAll('button').forEach(b => b.addEventListener('click', e => {
    const i = +e.target.dataset.i, act = e.target.dataset.act;
    if (act === 'sel') selectSegment(i);
    else if (act === 'del') deleteSegment(i);
    else if (act === 'ignore') ignoreWarningFrames();
    else if (act === 'bladeToggle') { state._bladeStatsExpandedIdx = (state._bladeStatsExpandedIdx === i) ? null : i; segRenderPanel(); }
  }));
  p.querySelectorAll('a.jump').forEach(a => a.addEventListener('click', e => goToFrame(+e.target.dataset.f)));
}

// Log file — debounced auto-write to user-chosen path
let _logTimer = null;
function scheduleLogWrite() {
  // Auto-log disabled — the Log button was removed, so we no longer create or
  // update omsni_log.json next to the videos. (Left as a no-op on purpose.)
}

async function writeLog() {
  const path = localStorage.getItem('omsni-log-path');
  if (!path || !window.api?.writeLog) return;
  const rect = getVideoRect('primary');
  const dims = getNativeDims('primary');
  const log = {
    timestamp: new Date().toISOString(), frame: state.frame,
    units: state.units,
    scale: state.scale ? { videoPxPerCm: state.scale.videoPxPerCm, cm: state.scale.cm } : null,
    lfit: state.lfit ? { base: state.lfit.base, joint: state.lfit.joint, angleOffset: state.lfit.angleOffset, videoPxPerCm: state.lfit.videoPxPerCm } : null,
    eye: state.eye, thumb: state.thumb, horizon: state.horizon, hip: state.hip,
    angles: {},
  };
  if (dims && rect && state.lfit && state.template && state.horizon && state.visible.horizon) {
    const { joint, base } = state.lfit;
    const θH = Math.atan2((joint.y-base.y)*dims.h, (joint.x-base.x)*dims.w);
    const ha = horizonAngleRad(state.horizon.p1, state.horizon.p2, rect);
    const haRight = Math.cos(ha) >= 0 ? ha : ha + Math.PI;
    log.angles.a = Math.min(angleDiffDeg(θH, haRight), angleDiffDeg(θH+Math.PI, haRight)).toFixed(2);
    if (state.eye && state.visible.eye) {
      const ep = toCanvas(state.eye, rect);
      const o  = toCanvas(joint, rect);
      const eyeAngle = Math.atan2(ep.y-o.y, ep.x-o.x);
      const haLeft = Math.cos(ha) >= 0 ? ha + Math.PI : ha;
      log.angles.c = angleDiffDeg(eyeAngle, haLeft).toFixed(2);
    }
  }
  if (dims && rect && state.hip?.shoulder && state.hip?.hip) {
    const H = toCanvas(state.hip.hip, rect), S = toCanvas(state.hip.shoulder, rect);
    const spineUp = Math.atan2(S.y-H.y, S.x-H.x);
    if (state.hip.frontKnee) { const FK = toCanvas(state.hip.frontKnee,rect); log.angles.hipF = angleDiffDeg(spineUp, Math.atan2(FK.y-H.y,FK.x-H.x)).toFixed(2); }
    if (state.hip.rearKnee)  { const RK = toCanvas(state.hip.rearKnee, rect); log.angles.hipR = angleDiffDeg(spineUp, Math.atan2(RK.y-H.y,RK.x-H.x)).toFixed(2); }
  }
  try { await window.api.writeLog(path, JSON.stringify(log, null, 2)); } catch(e) {}
}

async function pickAndSetLogPath() {
  if (!window.api?.pickLogPath) return;
  const p = await window.api.pickLogPath();
  if (p) { localStorage.setItem('omsni-log-path', p); await writeLog(); }
}

function tryLoadSavedDefaults() {
  try {
    const sv = parseFloat(localStorage.getItem('omsni-scale-v2'));
    const pxcm = sv > 0 ? sv : 14.4 / CM_PER_IN; // saved value, else 14.4 px/in factory default
    if (!state.scale)
      state.scale = { videoPxPerCm: pxcm, cm: 13, p1: null, p2: null };
  } catch(e) {
    if (!state.scale)
      state.scale = { videoPxPerCm: 14.4 / CM_PER_IN, cm: 13, p1: null, p2: null };
  }
}

window.addEventListener('beforeunload', saveDefaults);

// ── Template localStorage persistence ────────────────────────────────
function tryLoadSavedTemplate() {
  const load = (key) => {
    try {
      const s = localStorage.getItem(key);
      if (s) {
        const t = JSON.parse(s);
        if (t && t.handleLen > 0 && t.bladeLen > 0 && t.p1) return t;
      }
    } catch(e) {}
    return null;
  };
  // ALL blades are FIXED — always taken straight from the embedded code, never
  // from localStorage. The embedded constants define the blade geometry forever.
  state.templates[1] = { ...EMBEDDED_TEMPLATE_1 };
  state.templates[2] = { ...EMBEDDED_TEMPLATE_2 };
  state.templates[3] = { ...EMBEDDED_TEMPLATE_3 };
  state.templates[4] = { ...EMBEDDED_TEMPLATE_4 };
  state.activeTemplate = 1;                        // always start on blade 1 until the user switches
  state.template = state.templates[1];
  updateStepButtonStates();
  updateBladeToggle();
}

// Persist / load the secondary-view measurements (F, finger, horizon) so edits
// survive a restart; the embedded defaults are used when nothing is saved.
function persistSec() {
  try { localStorage.setItem('omsni-sec-v1', JSON.stringify({ secF: state.secF, secFinger: state.secFinger, secHorizon: state.secHorizon })); } catch(e) {}
}
function loadSecondaryDefaults() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('omsni-sec-v1') || 'null'); } catch(e) {}
  state.secF       = (saved && saved.secF)       || { ...EMBEDDED_SECF };
  state.secFinger  = (saved && saved.secFinger)  || { ...EMBEDDED_SECFINGER };
  state.secHorizon = (saved && saved.secHorizon) || { ...EMBEDDED_SECHORIZON };
}

// Switch which blade template drives Fit L (only changes Fit L size, not scale)
function setActiveTemplate(n) {
  if (n === state.activeTemplate) return;
  if (!state.templates[n] || !state.templates[n].p1) {
    const lbl = n === 4 ? 'Define Lc' : n === 3 ? 'Define L3' : n === 2 ? 'Define L2' : 'Define L';
    alert(`That blade template is not defined yet. Use "${lbl}" first.`);
    return;
  }
  state.activeTemplate = n;
  state.template = state.templates[n];
  localStorage.setItem('omsni-active-template', String(n));
  // No recompute needed: the handle (handleLen × Set Scale) and blade
  // (bladeLen × Set Scale) are derived live in getLFitJoint()/getLFitTip(), so
  // switching blades resizes BOTH handle and blade to the new template.
  updateBladeToggle();
  updateStepButtonStates();
  drawBothOverlays();
  // Remember this choice ON the selected segment so it's restored when the
  // segment is re-selected or the file is re-opened (#1). Guarded so it never
  // recurses through restoreSegActiveBlade (that only calls us when different).
  const _sg = (typeof segCurrent === 'function') ? segCurrent() : null;
  if (_sg && _sg.activeBlade !== n) { _sg.activeBlade = n; if (typeof segScheduleSave === 'function') segScheduleSave(); }
  // Switching blades changes which model tracks → reset cache and warm the new one.
  if (state.bladeTrackerEnabled && typeof resetBladeTracker === 'function') {
    resetBladeTracker();
    try { window.api?.bladeWarmup?.(n); } catch (e) {}
    scheduleBladeTrack();
  }
}

// Restore the active blade stored on the CURRENT segment (if any) — used on
// segment select and file open. Skips undefined/unavailable slots so it never
// triggers setActiveTemplate's "not defined yet" alert.
function restoreSegActiveBlade() {
  const sg = (typeof segCurrent === 'function') ? segCurrent() : null;
  if (!sg || sg.activeBlade == null) return;
  const n = sg.activeBlade;
  if (n === state.activeTemplate) return;
  if (!(state.templates[n] && state.templates[n].p1)) return;   // slot not defined → leave as-is
  setActiveTemplate(n);
}

function updateBladeToggle() {
  const btn = $('btn-blade-toggle');
  if (btn) btn.textContent = state.activeTemplate === 4 ? 'Blade C' : `Blade ${state.activeTemplate}`;
}

// ── Hide Video toggle ─────────────────────────────────────────────────
{ const btn = $('btn-hide-video');
  if (btn) btn.addEventListener('click', () => {
    state.hideVideo = !state.hideVideo;
    btn.classList.toggle('active', state.hideVideo);
    if (state.primary.ready)   drawFrame(state.primary);
    if (state.secondary.ready) drawFrame(state.secondary);
  });
}

// ── Export Media ──────────────────────────────────────────────────────
// Flatten video canvas + overlay canvas into one composite canvas.
// drawFrame writes to canvas-primary; drawOverlay writes to overlay-primary (separate element).
function _compositePanel(videoCanvas, overlayCanvas, out, x) {
  const ctx = out.getContext('2d');
  ctx.drawImage(videoCanvas, x, 0);
  ctx.drawImage(overlayCanvas, x, 0);
}

async function exportScreenshot() {
  const pc = els.canvasPrimary, po = els.overlayPrimary;
  const sc = state.secondary.ready ? els.canvasSecondary : null;
  const so = state.secondary.ready ? els.overlaySecondary : null;
  const totalW = pc.width + (sc ? sc.width : 0);
  const totalH = Math.max(pc.height, sc ? sc.height : 0);
  const tmp = document.createElement('canvas');
  tmp.width = totalW; tmp.height = totalH;
  const ctx = tmp.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, totalW, totalH);
  _compositePanel(pc, po, tmp, 0);
  if (sc && so) _compositePanel(sc, so, tmp, pc.width);
  const blob = await new Promise(resolve => tmp.toBlob(resolve, 'image/png'));
  const data = new Uint8Array(await blob.arrayBuffer());
  await window.api.saveMedia({ data, ext: 'png', defaultName: 'screenshot.png' });
}

async function exportVideoSegment(seg, isPaused = () => false) {
  const vs = state.primary;
  if (!vs.el) return;
  // ▶ Play auto-enables blade tracking whenever a blade template exists —
  // Export must do the same, or an off toggle (e.g. left off by an export-jump
  // restore) silently produces a pose-only video while Play looks fine.
  if (state.template) enableBladeTracker();
  clearTimeout(_bladeTimer);    // kill enableBladeTracker's 30ms retrack timer NOW —
  state._bladeToken++;          // the export loop drives all blade detection itself
  const fps = vs.fps || 30;
  // Composite video + overlay into a single export canvas for recording
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width  = els.canvasPrimary.width;
  exportCanvas.height = els.canvasPrimary.height;
  const exportCtx = exportCanvas.getContext('2d');

  const mimeType = MediaRecorder.isTypeSupported('video/mp4; codecs=avc1.42E01E')
    ? 'video/mp4; codecs=avc1.42E01E'
    : (MediaRecorder.isTypeSupported('video/webm; codecs=vp9') ? 'video/webm; codecs=vp9' : 'video/webm');
  const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';

  const stream = exportCanvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  // recorder.start() happens AFTER the warm-up lead-in below — starting it here
  // would record the blank export canvas while the trackers warm up.

  const savedFrame  = state.frame;
  const savedPose   = state.poseCurrent;
  const savedCompute = { ...state.compute };
  const N = Math.max(1, state.poseSmooth);
  const msPerFrame = 1000 / fps;
  const totalFrames = seg.end - seg.start + 1;

  // Block schedulePose and runVideoPose from interfering with export detection.
  // onSeeked fires schedulePose for every awaitMainFrame seek — without this guard
  // runVideoPose would reset the PoseEngine mid-export and corrupt timestamps.
  state.compute = { running: true, mode: 'export', paused: false, segIdx: -1, frame: null };
  if (!vs.el.paused) { vs.el.pause(); vs.el.muted = true; }

  // Reset PoseEngine once for a clean sequential tracking session (frames in order,
  // monotonically increasing timestamps) — mirrors what the compute loop does.
  let exportTs = 0;
  const canDetect = state.poseEnabled && !!window.PoseEngine;
  if (canDetect) { try { await window.PoseEngine.reset(); } catch (e) {} }

  // Blade tracking — export predates the blade tracker and never drove it
  // (scheduleBladeTrack bails on compute.running), so exported video froze or
  // omitted the Fit L. Mirror Compute/Play: Computed bladeData is authoritative;
  // otherwise a live in-order fast detect on the seeked frame, with the SAME
  // warm-up lead-in Play/Compute use so the smoothers are warm at seg.start.
  const wantBlade = state.bladeTrackerEnabled && !!state.template
    && (state.activeTemplate === 1 || state.activeTemplate === 2 || state.activeTemplate === 3)
    && !!window.BladeTracker && !!window.api?.bladeInfer;
  const bladeDims = wantBlade ? getNativeDims('primary') : null;
  const bladeRoi = state.bladeRoi || { x: 0, y: 0, w: 1, h: 1 };
  const savedLfit = state.lfit;
  if (bladeDims) {
    clearTimeout(_bladeTimer);   // a pre-export scheduled detect must not fire mid-loop
    state._bladeToken++;
    // Fresh smoother history for this in-order walk (warmed by the lead-in below).
    bladeSmoother()?.reset();
    bladeAngleSmoother()?.reset();
  }

  // ── Warm-up lead-in (Compute's warmStart / Play's pre-buffer, before recording):
  // walk the N-1 frames before the segment through pose AND blade in order,
  // detect-only — nothing is drawn to the export canvas and the recorder is not
  // running yet, so these frames never appear in the file. Without this the
  // trackers start COLD at seg.start (unsmoothed pose, jumpy blade detections).
  const warmStart = (canDetect || bladeDims) ? Math.max(0, seg.start - (N - 1)) : seg.start;
  const warmTotal = Math.max(1, seg.start - warmStart);
  for (let F = warmStart; F < seg.start; F++) {
    await awaitMainFrame(F);
    state.frame = F;
    exportTs += 33;
    const wk = _poseKey(F, N);
    if (!state.poseCache[F] && !state.poseDetCache.has(wk) && canDetect && vs.el.readyState >= 2) {
      let res;
      try { res = await window.PoseEngine.detectForVideo(_roiImg(vs.el), exportTs); } catch (e) {}
      const lms = _remapROI(_toArr(res));
      if (lms) poseDetCachePut(F, N, lms);
    }
    if (bladeDims) {
      showBladeProgress('Blade warm-up…');
      try { await bladeDetectAndSmooth(vs.el, bladeRoi, bladeDims, state.activeTemplate, true); } catch (e) {}
    }
    showBufferingLabel(`Export warm-up… ${F - warmStart + 1} / ${warmTotal}`);
    setBufferBar(Math.round((F - warmStart + 1) / warmTotal * 100));
    while (isPaused()) await new Promise(r => setTimeout(r, 150));
  }

  recorder.start(200);

  for (let F = seg.start; F <= seg.end; F++) {
    const t0 = performance.now();
    await awaitMainFrame(F);
    state.frame = F;
    updateSliderAndLabel('primary', F);
    exportTs += 33;  // monotonic timestamp for the pose model video-mode tracking

    // Resolve pose for this frame: manual edit → det cache → live detection on seeked frame
    const ck = _poseKey(F, N);
    if (state.poseCache[F]) {
      state.poseCurrent = { frame: F, landmarks: state.poseCache[F], edited: true };
    } else if (state.poseDetCache.has(ck)) {
      const lms = state.poseDetCache.get(ck);
      state.poseCurrent = lms ? { frame: F, landmarks: lms, edited: false } : null;
    } else if (canDetect && vs.el.readyState >= 2) {
      // Primary video is already seeked to F — detect directly (single-frame, best-effort).
      // Tracking context carries over from prior frames since we process them in order.
      let res;
      try { res = await window.PoseEngine.detectForVideo(_roiImg(vs.el), exportTs); } catch (e) {}
      const lms = _remapROI(_toArr(res));
      if (lms) poseDetCachePut(F, N, lms);
      state.poseCurrent = lms ? { frame: F, landmarks: lms, edited: false } : null;
    } else {
      state.poseCurrent = null;
    }

    // Blade for this frame — the LIVE pipeline, exactly what ▶ Play and Compute
    // display: a fresh in-order fast detect on the seeked frame (warm smoothers
    // + LSD refine, all inside bladeDetectAndSmooth). Deliberately NO reads from
    // stored seg.bladeData or _bladeCache: replaying values produced under an
    // OLDER session's ROI/settings/smoother history — and switching between
    // stored and live at coverage boundaries — is what made some exported
    // frames jump to detections Play/Compute never showed.
    // redraw=false — drawFrame below repaints the overlay once.
    if (bladeDims) {
      showBladeProgress(`Blade ${Math.round((F - seg.start + 1) / totalFrames * 100)}%`, Math.round((F - seg.start + 1) / totalFrames * 100));
      let out = { none: true };
      try { out = await bladeDetectAndSmooth(vs.el, bladeRoi, bladeDims, state.activeTemplate, true); } catch (e) {}
      if (out.res) { _bladeCache.set(F, out.res); applyBladeResult(out.res, bladeDims, false); }
      else if (out.none) { _bladeCache.set(F, null); clearBladeFit(false); }
      // out.reject → fast-mode outlier: hold the previous frame's L (same as Play)
    }

    drawFrame(vs);   // → canvas-primary (video/black) + overlay-primary (pose/meas/CC)
    // Flatten both layers onto the export canvas that MediaRecorder is watching
    exportCtx.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportCtx.drawImage(els.canvasPrimary,  0, 0);
    exportCtx.drawImage(els.overlayPrimary, 0, 0);

    // Progress indicator (same buffer bar as play/compute)
    const done = F - seg.start + 1;
    setBufferBar(Math.round((done / totalFrames) * 100));
    showBufferingLabel(`Exporting… ${done} / ${totalFrames}`);

    const elapsed = performance.now() - t0;
    if (elapsed < msPerFrame) await new Promise(r => setTimeout(r, msPerFrame - elapsed));

    // Pause support — spin here while the user has paused the export
    while (isPaused()) {
      showBufferingLabel(`Export paused — ${done} / ${totalFrames}`);
      await new Promise(r => setTimeout(r, 150));
    }
  }

  recorder.stop();
  await new Promise(resolve => recorder.addEventListener('stop', resolve, { once: true }));
  hideBufferingLabel(); hideBufferBar();
  if (bladeDims) hideBladeProgress();

  // Restore state
  state.compute = savedCompute;
  state.frame = savedFrame;
  state.poseCurrent = savedPose;
  if (bladeDims) {
    // Put the pre-export Fit L back; the awaitMainFrame seek below re-fires
    // scheduleBladeTrack (compute no longer running) which re-detects the
    // parked frame accurately anyway.
    state.lfit = savedLfit;
    bladeSmoother()?.reset();
    bladeAngleSmoother()?.reset();
  }
  if (canDetect) { try { await window.PoseEngine.reset(); } catch (e) {} }
  await awaitMainFrame(savedFrame);
  drawFrame(vs);
  updateComputeBtns();

  const blob = new Blob(chunks, { type: mimeType });
  const data = new Uint8Array(await blob.arrayBuffer());
  await window.api.saveMedia({ data, ext, defaultName: `seg_${seg.start}-${seg.end}.${ext}` });
}

{ const btn = $('btn-export-media');
  let _exportPaused = false;
  let _exportRunning = false;
  if (btn) btn.addEventListener('click', async () => {
    if (!state.primary.ready) { alert('Load a primary video first.'); return; }

    // Pause/resume toggle while exporting
    if (_exportRunning) {
      _exportPaused = !_exportPaused;
      btn.textContent = _exportPaused ? '▶ Resume' : '⏸ Pause';
      return;
    }

    const segPanelOpen = $('btn-seg-panel')?.classList.contains('active');
    const seg = segCurrent();
    const hasSeg = segPanelOpen && seg && seg.start != null && seg.end != null;

    _exportRunning = true; _exportPaused = false;
    btn.textContent = hasSeg ? '⏸ Pause' : 'Saving…';
    try {
      if (hasSeg) await exportVideoSegment(seg, () => _exportPaused);
      else        await exportScreenshot();
    } catch (e) { alert('Export failed: ' + (e.message || e)); }
    _exportRunning = false; _exportPaused = false;
    btn.textContent = 'Export Media';
  });
}

// ── Init ──────────────────────────────────────────────────────────────
setupCanvasEvents('primary');
setupCanvasEvents('secondary');
{ const u = localStorage.getItem('omsni-custom-tpl-pic'); if (u) state.checker.customUrl = u; }
tryLoadSavedTemplate();
loadSecondaryDefaults();   // embed F / finger / secondary-horizon defaults
tryLoadSavedDefaults();
// The Load list holds exactly ONE entry: "default" — the complete, correct
// embedded ref (all 4 blades + secondary + scale). Any other saved sets are
// removed so the picker is clean, and "default" is reset to the embedded data
// every launch (never drifts/corrupts). Your setups also live in the
// omsni_defs*.json files — use "Load from file…" for those.
(function ensureDefaultDefs() {
  for (const name of getDefsIndex()) {
    if (name !== 'default') localStorage.removeItem('omsni-defs:' + name);
  }
  localStorage.setItem('omsni-defs:default', JSON.stringify(EMBEDDED_DEFAULTS));
  setDefsIndex(['default']);
  localStorage.setItem('omsni-defs-last', 'default');
})();
// Startup shows NOTHING: no auto-loaded defs. The L template and the embedded
// secondary measurements (F / finger / horizon) are loaded but HIDDEN until the
// user clicks their tab — same as every primary layer.
state.visible.template   = false;
state.visible.secF       = false;
state.visible.secFinger  = false;
state.visible.secHorizon = false;
updatePointPanel();
// Segment file: start with NO active file (so the create/choose requirement
// never fires at startup and default Defs load normally). The dropdown lists
// segments inside the active file (none yet).
segUpdateFileName();
segRefreshSegDropdown();
segRenderPanel();
drawSegBars();
refreshExportJump();
updateComputeBtns();
updateMarkBtns();
updateBladeSubMarkBtns();

// ── Timecode input event listeners ───────────────────────────────────
['primary', 'secondary'].forEach(id => {
  const P = id === 'primary';
  const mm = P ? els.tcMmPrimary   : els.tcMmSecondary;
  const ss = P ? els.tcSsPrimary   : els.tcSsSecondary;
  const ms = P ? els.tcMsPrimary   : els.tcMsSecondary;
  const fr = P ? els.tcFrPrimary   : els.tcFrSecondary;
  const onTc = () => {
    const fps = state[id].fps || 30;
    goToFrame(Math.round(((+mm.value||0)*60 + (+ss.value||0) + (+ms.value||0)/1000) * fps));
  };
  mm.addEventListener('change', onTc);
  ss.addEventListener('change', onTc);
  ms.addEventListener('change', onTc);
  fr.addEventListener('change', () => goToFrame(parseInt(fr.value, 10) || 0));
});

// Auto-load reference checkerboard photo into primary on startup
{
  const href   = window.location.href;                      // file://.../renderer/index.html
  const rendererDir = href.substring(0, href.lastIndexOf('/'));  // file://.../renderer
  const appDir = rendererDir.substring(0, rendererDir.lastIndexOf('/'));  // file://...
  loadVideoUrl('primary', appDir + '/blade_checkerboard.jpeg');
}

// ── Audio panel ───────────────────────────────────────────────────────────
{ const btn = $('btn-audio-panel'), panel = $('audio-panel');
  if (btn && panel) btn.addEventListener('click', () => {
    const open = panel.style.display === 'none';
    panel.style.display = open ? 'block' : 'none';
    btn.classList.toggle('active', open);
  });
}

function updateTranscriptUI() {
  const t = state.audioTranscript;
  const btn = $('btn-audio-transcribe');
  const status = $('audio-status');
  const results = $('audio-results');
  if (t && Array.isArray(t.words) && t.words.length > 0) {
    const complete = (t.processedCount ?? 0) >= (t.mergedCount ?? 1) && (t.mergedCount ?? 0) > 0;
    if (btn) btn.textContent = complete ? '🎙 Re-transcribe' : '▶ Resume';
    if (status) status.textContent = `Transcript: ${t.words.length} words, ${(t.segments || []).length} segments.`;
  } else {
    if (btn) btn.textContent = '🎙 Extract & Transcribe';
    if (status && !_audioScanRunning) status.textContent = '—';
  }
  // Hide stale search results when transcript changes
  if (results) { results.innerHTML = ''; results.style.display = 'none'; }
}

{ const btn = $('btn-cc-toggle');
  if (btn) btn.addEventListener('click', () => {
    if (!state.audioTranscript) { $('audio-status').textContent = 'Run Extract & Transcribe first.'; return; }
    state.ccEnabled = !state.ccEnabled;
    btn.classList.toggle('active', state.ccEnabled);
    btn.textContent  = state.ccEnabled ? 'CC ✓' : 'CC';
    btn.style.color  = state.ccEnabled ? '#20c997' : '';
    if (state.primary.ready) drawOverlay('primary');
  });
}

{ const btn = $('btn-roi');
  if (btn) btn.addEventListener('click', () => {
    state.roiEnabled = !state.roiEnabled;
    if (!state.roiEnabled) state._roiDraw = null;  // keep state.roi; just hide it
    btn.classList.toggle('active', state.roiEnabled);
    if (els.wrapPrimary) els.wrapPrimary.style.cursor = state.roiEnabled ? 'crosshair' : '';
    state.poseDetCache.clear(); state.poseCurrent = null;
    if (state.primary.ready) drawOverlay('primary');
  });
}
// Enable/disable the blade tracker. No Blade ROI is required (tracks the whole
// frame when none is drawn). Shared by the Track button and ▶ Play.
function enableBladeTracker() {
  if (state.bladeTrackerEnabled) return true;
  if (!state.template) {   // need an active blade template to place Fit L
    const b = $('btn-blade-track');
    if (b) { b.style.outline = '2px solid #f03e3e'; setTimeout(() => { b.style.outline = ''; }, 900); }
    return false;
  }
  state.bladeTrackerEnabled = true;
  $('btn-blade-track')?.classList.add('active');
  pushUndo();              // snapshot so Undo restores the pre-tracker state
  resetBladeTracker();     // start smoothing + cache fresh (also clears stale state)
  try { window.api?.bladeWarmup?.(state.activeTemplate); } catch (e) {}
  forceBladeRetrack();     // detect on the current frame now (bypass compute guard)
  return true;
}
function disableBladeTracker() {
  if (!state.bladeTrackerEnabled) return;
  state.bladeTrackerEnabled = false;
  $('btn-blade-track')?.classList.remove('active');
  resetBladeTracker();     // leaves the last Fit L in place
}
{ const btn = $('btn-blade-track');
  if (btn) btn.addEventListener('click', () => {
    if (state.bladeTrackerEnabled) disableBladeTracker(); else enableBladeTracker();
  });
}
{ const btn = $('btn-blade-raw');
  if (btn) btn.addEventListener('click', () => {
    state.bladeDebug = !state.bladeDebug;
    btn.classList.toggle('active', state.bladeDebug);
    if (state.primary.ready) drawOverlay('primary');
  });
}
{ const b = $('btn-blade-sub-start'); if (b) b.addEventListener('click', markBladeSubStart); }
{ const b = $('btn-blade-sub-end');   if (b) b.addEventListener('click', markBladeSubEnd); }
{ const b = $('clear-blade-sub');     if (b) b.addEventListener('click', clearBladeSub); }
{ const b = $('btn-blade-exclude');   if (b) b.addEventListener('click', excludeCurrentFrameBlade); }
{ const b = $('btn-eye-track');   if (b) b.addEventListener('click', toggleEyeTracker); }
{ const b = $('btn-eye-exclude'); if (b) b.addEventListener('click', excludeCurrentFrameEye); }
// Subsegment dropdown: click the "Subsegment ▾" button to open/close the
// popover; click anywhere else on the page to close it (standard dropdown UX).
{ const btn = $('btn-blade-sub-menu'), menu = $('blade-sub-menu');
  if (btn && menu) {
    // NOTE: toggles menu.style.display directly (not a CSS class) — the menu
    // has other inline styles (position/layout) already on it, and an inline
    // style ALWAYS wins over a class-based rule regardless of specificity, so
    // a "hidden" class here would never actually have hidden it.
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = menu.style.display === 'none';
      menu.style.display = opening ? 'flex' : 'none';
      btn.classList.toggle('active', opening);
      if (opening) updateBladeSubMarkBtns();
    });
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => {
      if (menu.style.display !== 'none') { menu.style.display = 'none'; btn.classList.remove('active'); }
    });
  }
}
{ const btn = $('btn-blade-refine');
  if (btn) btn.addEventListener('click', () => {
    state.bladeRefineEnabled = !state.bladeRefineEnabled;
    btn.classList.toggle('active', state.bladeRefineEnabled);
    resetBladeTracker();        // refinement changes the angle → invalidate cache
    scheduleBladeTrack();
  });
}
{ const btn = $('btn-blade-smooth');
  if (btn) btn.addEventListener('click', () => {
    state.bladeSmoothEnabled = !state.bladeSmoothEnabled;
    btn.classList.toggle('active', state.bladeSmoothEnabled);
    resetBladeTracker();        // smoothing changes results → invalidate cache
    scheduleBladeTrack();       // re-track current frame with the new setting
  });
}
{ const btn = $('btn-blade-roi');
  if (btn) btn.addEventListener('click', () => {
    state.bladeRoiEnabled = !state.bladeRoiEnabled;
    if (!state.bladeRoiEnabled) state._bladeRoiDraw = null;   // keep region; just hide it
    btn.classList.toggle('active', state.bladeRoiEnabled);
    if (els.wrapPrimary) els.wrapPrimary.style.cursor = state.bladeRoiEnabled ? 'crosshair' : '';
    if (state.primary.ready) drawOverlay('primary');
  });
}
{ const btn = $('clear-blade-roi');
  if (btn) btn.addEventListener('click', () => {
    state.bladeRoi = null; state.bladeRoiEnabled = false; state._bladeRoiDraw = null;
    $('btn-blade-roi')?.classList.remove('active');
    if (els.wrapPrimary) els.wrapPrimary.style.cursor = '';
    // ROI is optional now — deleting it just drops the region; the tracker keeps
    // running on the whole frame. Invalidate the cache so it re-detects.
    resetBladeTracker();
    if (state.bladeTrackerEnabled) scheduleBladeTrack();
    segScheduleSave();
    if (state.primary.ready) drawOverlay('primary');
  });
}
{ const btn = $('clear-roi');
  if (btn) btn.addEventListener('click', () => {
    state.roi = null; state.roiEnabled = false; state._roiDraw = null;
    $('btn-roi')?.classList.remove('active');
    if (els.wrapPrimary) els.wrapPrimary.style.cursor = '';
    state.poseDetCache.clear(); state.poseCurrent = null;
    segScheduleSave();
    if (state.primary.ready) drawOverlay('primary');
  });
}

window.api.onAudioProgress(({ pct, msg }) => {
  const bar = $('audio-buf-bar');
  if (bar) bar.style.width = pct + '%';
  if (_audioScanRunning) { const s = $('audio-status'); if (s) s.textContent = msg; }
});

// Extract & Transcribe — also serves as ⏸ Pause / ▶ Resume toggle
let _audioScanRunning = false;
{ const btn = $('btn-audio-transcribe');
  if (btn) btn.addEventListener('click', async () => {
    if (_audioScanRunning) {
      // Pause: tell main to abort after current chunk finishes
      btn.disabled = true;
      btn.textContent = 'Pausing…';
      await window.api.audioScanCancel();
      // Button label + state restored when the awaited audioScan call returns below
      return;
    }
    if (!state.primary.ready || !state.primary.el) {
      $('audio-status').textContent = 'Load a primary video first.'; return;
    }
    if (!segRequireFile()) return;

    // If a complete transcript already exists, confirm before overwriting
    const _existing = state.audioTranscript;
    const _existComplete = _existing && Array.isArray(_existing.words) && _existing.words.length > 0 &&
      (_existing.processedCount ?? 0) >= (_existing.mergedCount ?? 1) && (_existing.mergedCount ?? 0) > 0;
    if (_existComplete) {
      if (!confirm('This will re-extract the audio and re-transcribe everything, replacing the current transcript in the JSON file.\n\nContinue?')) return;
      state.audioTranscript = null;  // force fresh run
    }

    _audioScanRunning = true;
    btn.textContent = '⏸ Pause';
    $('audio-buf-bar').style.width = '0%';

    const sensitivity = $('audio-sens')?.value || 'default';
    const res = await window.api.audioScan({ videoUrl: state.primary.el.src, existingTranscript: state.audioTranscript, sensitivity });
    _audioScanRunning = false;
    btn.disabled = false;

    if (!res.ok) { btn.textContent = '🎙 Extract & Transcribe'; $('audio-status').textContent = 'Error: ' + res.error; return; }

    state.audioTranscript = res.transcript || null;
    if (state.audioTranscript) segScheduleSave();
    updateTranscriptUI();
  });
}

// Search — client-side keyword filter on the loaded transcript
{ const btn = $('btn-audio-search');
  if (btn) btn.addEventListener('click', () => {
    if (!state.audioTranscript) { $('audio-status').textContent = 'Run Extract & Transcribe first.'; return; }
    const kw  = ($('audio-keyword')?.value || '').trim().toLowerCase();
    if (!kw)  { $('audio-status').textContent = 'Enter a keyword.'; return; }
    const fps  = state.primary.fps || 30;

    const matches = (state.audioTranscript.words || []).filter(w => w.word === kw);
    const sel = $('audio-results');
    sel.innerHTML = '';
    if (!matches.length) {
      sel.style.display = 'none';
      $('audio-status').textContent = `No matches for "${kw}"`;
    } else {
      sel.style.display = '';
      const hdr = document.createElement('option');
      hdr.value = ''; hdr.textContent = `${matches.length} matches: select to jump`;
      sel.appendChild(hdr);
      const kwDisp = kw.length > 8 ? kw.slice(0, 8) + '…' : kw;
      matches.forEach(({ startSec }, i) => {
        const frame = Math.round(startSec * fps);
        const mm = String(Math.floor(startSec / 60)).padStart(2, '0');
        const ss = String(Math.floor(startSec % 60)).padStart(2, '0');
        const opt = document.createElement('option');
        opt.value = String(frame);
        opt.textContent = `#${i + 1} "${kwDisp}" at ${mm}:${ss}`;
        sel.appendChild(opt);
      });
      $('audio-status').textContent = `${matches.length} match${matches.length !== 1 ? 'es' : ''} found`;
    }
  });
}

$('audio-results')?.addEventListener('change', e => {
  const f = parseInt(e.target.value, 10);
  if (!isNaN(f) && f >= 0) goToFrame(f);
  // keep selected value showing in collapsed dropdown
});

// ── STUB: Tutorial overlay ────────────────────────────────────────────
// When the guide is ready, build a #tutorial-overlay div in index.html
// and wire a button in #toolbar to toggle it. The overlay should walk
// through: load video → set scale → re-pose → place eye → place horizon.
