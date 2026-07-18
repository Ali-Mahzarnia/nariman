// MediaPipe Pose engine — runs in the renderer (main world) as an ES module.
// Loaded via the privileged `mpassets://assets/pose-engine.js` URL so that its
// sibling imports (the vision bundle) and the WASM fileset resolve on the same
// origin and `fetch` is permitted. It exposes a tiny CPU-friendly API on
// `window.PoseEngine` that app.js (a classic script) calls per frame.
import { FilesetResolver, PoseLandmarker } from './vision_bundle.mjs';

// Cached after first load so reset() can recreate the landmarker without any
// network fetch or WASM re-init.
let _fileset = null;
let _modelBytes = null; // Uint8Array — stored so new Uint8Array(_modelBytes) always gives a fresh copy
let _landmarker = null;

const LANDMARKER_OPTS = {
  runningMode: 'VIDEO',
  numPoses: 1,
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  outputSegmentationMasks: false,
};

async function createLandmarker() {
  if (!_fileset)    _fileset    = await FilesetResolver.forVisionTasks('mpassets://assets/wasm');
  if (!_modelBytes) _modelBytes = new Uint8Array(await fetch('mpassets://assets/model.task').then(r => r.arrayBuffer()));
  // new Uint8Array(_modelBytes) copies the data into a fresh buffer each call.
  // MediaPipe may transfer (detach) that buffer internally; _modelBytes itself is never passed
  // directly and is never detached, so reset() can recreate the landmarker indefinitely.
  return PoseLandmarker.createFromOptions(_fileset, {
    baseOptions: { modelAssetBuffer: new Uint8Array(_modelBytes), delegate: 'CPU' },
    ...LANDMARKER_OPTS,
  });
}

async function getLandmarker() {
  if (!_landmarker) _landmarker = await createLandmarker();
  return _landmarker;
}

window.PoseEngine = {
  ready: false,
  initError: null,
  POSE_CONNECTIONS: PoseLandmarker.POSE_CONNECTIONS,

  async warmup() {
    try { await getLandmarker(); this.ready = true; return true; }
    catch (e) { this.initError = e; console.error('[PoseEngine] init failed:', e); return false; }
  },

  // Discard the current landmarker and create a fresh one.  The fileset and
  // model bytes are already in memory so this is graph-init only (~fast).
  // Call before every mini-run to guarantee no stale tracker state leaks in.
  async reset() {
    if (_landmarker) { try { _landmarker.close(); } catch (e) {} _landmarker = null; }
    _landmarker = await createLandmarker();
  },

  async detectForVideo(image, timestampMs) {
    const lm = await getLandmarker();
    const res = lm.detectForVideo(image, timestampMs);
    return (res && res.landmarks && res.landmarks[0]) ? res.landmarks[0] : null;
  },
};

window.dispatchEvent(new Event('pose-engine-ready'));
