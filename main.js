const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { spawn } = require('child_process');
const MP4Box = require('mp4box');

// ── External binary paths ─────────────────────────────────────────────────
// Returns path to a bundled binary ('ffmpeg' or 'whisper').
// Dev (npm start): <project>/resources/bin/<plat-arch>/<name>[.exe]
// Packaged:        process.resourcesPath/bin/<plat-arch>/<name>[.exe]
function getBinPath(name) {
  const plat = process.platform === 'darwin' ? 'mac' : 'win';
  const arch = process.arch;           // 'arm64' | 'x64' | 'ia32'
  const ext  = process.platform === 'win32' ? '.exe' : '';
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'bin', `${plat}-${arch}`)
    : path.join(__dirname, 'resources', 'bin', `${plat}-${arch}`);
  return path.join(base, name + ext);
}

// Returns path to the bundled Whisper tiny model.
function getModelPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'models', 'ggml-small.en.bin')
    : path.join(__dirname, 'resources', 'models', 'ggml-small.en.bin');
}

// ── Blade-pose ONNX inference ──────────────────────────────────────────────
// Three YOLO11n-pose models (blade1/2/3). The renderer preprocesses one frame
// into a 1×3×640×640 float32 tensor and sends it here; we run it on CPU
// (onnxruntime-node) and hand the raw (1,11,8400) output back so the renderer's
// verified decoder can turn it into base + angle. Sessions are created lazily
// and cached per blade.
function getBladeModelPath(blade) {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'models')
    : path.join(__dirname, 'resources', 'models');
  return path.join(base, `blade${blade}.onnx`);
}

let _ort = null;
const _bladeKit = require(path.join(__dirname, 'renderer', 'blade', 'blade-tracker.js'));
const _bladeSessions = new Map(); // blade(int) -> InferenceSession
async function getBladeSession(blade) {
  if (_bladeSessions.has(blade)) return _bladeSessions.get(blade);
  if (!_ort) {
    // Windows: if we bundled the VC++ runtime DLLs, add that folder to the DLL
    // search path so onnxruntime.dll finds vcruntime140/msvcp140 without the
    // machine having the redistributable installed. No-op if not bundled.
    if (process.platform === 'win32') {
      try {
        const vc = app.isPackaged
          ? path.join(process.resourcesPath, 'vcruntime')
          : path.join(__dirname, 'resources', 'win-vcruntime', process.arch);
        if (fs.existsSync(vc)) process.env.PATH = vc + path.delimiter + (process.env.PATH || '');
      } catch (e) {}
    }
    _ort = require('onnxruntime-node');
  }
  const p = getBladeModelPath(blade);
  if (!fs.existsSync(p)) throw new Error(`blade model not found: ${p}`);
  const sess = await _ort.InferenceSession.create(p, { executionProviders: ['cpu'] });
  _bladeSessions.set(blade, sess);
  return sess;
}

// ── Audio helpers ─────────────────────────────────────────────────────────
// Energy-based VAD on 16 kHz mono 16-bit PCM WAV.
// Returns [{startSec, endSec}] speech regions (with padding).
function wavVAD(wavPath, sensitivity = 'default') {
  const buf = fs.readFileSync(wavPath);
  let sampleRate = 16000, bitsPerSample = 16, dataOffset = 44, dataSize = buf.length - 44;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if      (id === 'fmt ')  { sampleRate = buf.readUInt32LE(off + 12); bitsPerSample = buf.readUInt16LE(off + 22); }
    else if (id === 'data')  { dataOffset = off + 8; dataSize = sz; break; }
    off += 8 + (sz & ~1);
  }
  const bps = bitsPerSample >> 3;
  const FRAME_MS = 30, frameSize = Math.floor(sampleRate * FRAME_MS / 1000);
  const totalSamp = Math.floor(dataSize / bps), frameDur = FRAME_MS / 1000;
  const rmsArr = [];
  for (let s = 0; s < totalSamp; s += frameSize) {
    const end = Math.min(s + frameSize, totalSamp); let e = 0;
    for (let i = s; i < end; i++) {
      const b = dataOffset + i * bps;
      const v = bps === 2 ? buf.readInt16LE(b) / 32768
              : bps === 4 ? buf.readInt32LE(b) / 2147483648
              : (buf.readUInt8(b) - 128) / 128;
      e += v * v;
    }
    rmsArr.push(Math.sqrt(e / (end - s)));
  }
  const sorted = rmsArr.slice().sort((a, b) => a - b);
  const threshScale = sensitivity === 'high' ? 0.5 : sensitivity === 'low' ? 2.0 : 1.0;
  const threshold = Math.max(sorted[Math.floor(sorted.length * 0.20)] * 4, 0.003) * threshScale;
  const isSpeech = rmsArr.map(r => r >= threshold);
  // Fill gaps ≤ 600 ms so nearby speech bursts merge
  const GAP = Math.ceil(600 / FRAME_MS);
  for (let i = 0; i < isSpeech.length; ) {
    if (!isSpeech[i]) {
      let j = i; while (j < isSpeech.length && !isSpeech[j]) j++;
      if (j - i <= GAP) for (let k = i; k < j; k++) isSpeech[k] = true;
      i = j;
    } else i++;
  }
  const PAD = Math.ceil(400 / FRAME_MS), MIN = Math.ceil(600 / FRAME_MS), totalDur = totalSamp / sampleRate;
  const segs = []; let start = -1;
  for (let i = 0; i <= isSpeech.length; i++) {
    if (i < isSpeech.length && isSpeech[i]) { if (start < 0) start = i; }
    else if (start >= 0) {
      if (i - start >= MIN) segs.push({ startSec: Math.max(0, (start - PAD) * frameDur), endSec: Math.min(totalDur, (i - 1 + PAD) * frameDur) });
      start = -1;
    }
  }
  return segs;
}

// Merge consecutive VAD segments separated by gaps ≤ maxGapSec into longer
// chunks (capped at maxDurSec). More context → better Whisper accuracy.
function mergeVADSegments(segs, maxGapSec = 3.0, maxDurSec = 60.0) {
  if (!segs.length) return [];
  const groups = [];
  let cur = { startSec: segs[0].startSec, endSec: segs[0].endSec };
  for (let i = 1; i < segs.length; i++) {
    const gap    = segs[i].startSec - cur.endSec;
    const newDur = segs[i].endSec   - cur.startSec;
    if (gap <= maxGapSec && newDur <= maxDurSec) {
      cur.endSec = segs[i].endSec;
    } else {
      groups.push(cur);
      cur = { startSec: segs[i].startSec, endSec: segs[i].endSec };
    }
  }
  groups.push(cur);
  return groups;
}

function extractChunk(ffmpegBin, src, startSec, durationSec, outPath) {
  return new Promise((resolve, reject) => {
    const args = ['-y', '-i', src, '-ss', String(startSec), '-t', String(durationSec), '-ar', '16000', '-ac', '1', '-f', 'wav', outPath];
    const proc = spawn(ffmpegBin, args);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
    proc.on('error', reject);
  });
}

// Run whisper.cpp; returns {words, segments} with times offset by startOffsetSec.
async function runWhisper(whisperBin, modelPath, wavPath, startOffsetSec, sensitivity = 'default') {
  // Use a base path without extension for -of so whisper always writes <base>.json.
  // Passing the full .wav path causes whisper.cpp on Windows to strip the .wav
  // extension itself, writing <base>.json instead of <base>.wav.json.
  const outputBase = wavPath.replace(/\.[^.]+$/, '');
  await new Promise((resolve, reject) => {
    const args = ['-m', modelPath, '-f', wavPath, '-oj', '-of', outputBase, '-l', 'en', '-np', '-wt', '0'];
    if (sensitivity === 'high') args.push('-nth', '0.2');
    else if (sensitivity === 'low') args.push('-nth', '0.7');
    const proc = spawn(whisperBin, args);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => {
      if (code === 0 || fs.existsSync(outputBase + '.json')) resolve();
      else reject(new Error(stderr.slice(-300) || `whisper exit ${code}`));
    });
    proc.on('error', reject);
  });
  const words = [], segments = [];
  try {
    const data = JSON.parse(fs.readFileSync(outputBase + '.json', 'utf8'));
    for (const seg of (data.transcription || [])) {
      const t = (seg.text || '').trim();
      if (!t) continue;
      const segStart = startOffsetSec + (seg.offsets?.from ?? 0) / 1000;
      const segEnd   = startOffsetSec + (seg.offsets?.to   ?? 0) / 1000;
      segments.push({ startSec: segStart, endSec: segEnd, text: t });
      const ws = t.toLowerCase().replace(/[^a-z0-9'' ]/g, ' ').split(/\s+/).filter(Boolean);
      for (const w of ws) words.push({ word: w, startSec: segStart, endSec: segEnd, p: 1 });
    }
  } catch {}
  try { fs.unlinkSync(outputBase + '.json'); } catch {}
  return { words, segments };
}

// ── MediaPipe asset scheme ────────────────────────────────────────────────
// fetch(file://) is blocked in the renderer, so the MediaPipe WASM runtime,
// the ESM bundle, the pose engine module and the model are served over a
// privileged custom scheme instead. Everything lives under one host ("assets")
// so it shares a single origin (relative imports + the WASM fileset just work).
// Registration must happen before app "ready".
protocol.registerSchemesAsPrivileged([{
  scheme: 'mpassets',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

const MP_VENDOR = path.join(__dirname, 'node_modules', '@mediapipe', 'tasks-vision');
function mpAssetPath(pathname) {
  // pathname is the URL path, e.g. "/wasm/vision_wasm_internal.wasm"
  if (pathname === '/pose-engine.js') return path.join(__dirname, 'renderer', 'pose', 'pose-engine.js');
  if (pathname === '/model.task')     return path.join(__dirname, 'assets', 'pose_landmarker_full.task');
  // wasm/*, vision_bundle.mjs, *.map → straight from the installed package
  return path.join(MP_VENDOR, pathname);
}
const MP_MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
  '.map': 'application/json', '.json': 'application/json', '.task': 'application/octet-stream',
};
function registerMpProtocol() {
  protocol.handle('mpassets', async (req) => {
    try {
      const { pathname } = new URL(req.url);
      const file = mpAssetPath(decodeURIComponent(pathname));
      const data = await fs.promises.readFile(file);
      const ext  = path.extname(file).toLowerCase();
      return new Response(data, {
        headers: {
          'content-type': MP_MIME[ext] || 'application/octet-stream',
          'access-control-allow-origin': '*',
          'cache-control': 'no-cache',
        },
      });
    } catch (err) {
      console.error('[mpassets] failed to serve', req.url, err.message);
      return new Response('not found', { status: 404 });
    }
  });
}

// On macOS, Electron's GPU subprocess inherits the terminal's open file
// descriptors and crashes when fd 9 is in a bad state. Running the GPU
// in-process avoids the fork entirely and eliminates the SIGTRAP crash.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('in-process-gpu');
}

// Ensure only one instance runs — duplicate launch causes fd conflicts
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// Build marker — bump when shipping notable UI changes so a running copy can be
// told apart from a stale one. Shown in the window title bar.
const BUILD_TAG = 'Pose build';

let mainWin = null;
app.on('second-instance', () => {
  // A second `npm start` (or relaunch) reloads the live window FROM DISK so it
  // always reflects the latest source — no more stale UI after editing files.
  // Guard: on macOS the window can be destroyed (closed) while the app keeps
  // running and holding the single-instance lock. Touching a destroyed window
  // throws "Object has been destroyed", so recreate it instead.
  if (mainWin && !mainWin.isDestroyed()) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.webContents.reloadIgnoringCache();
    mainWin.focus();
  } else {
    createWindow();
  }
});

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    title: 'NARIMAN',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Absolute path — a relative loadFile can fail to resolve in a packaged/portable
  // build (different CWD), which would leave the window hidden forever (process in
  // Task Manager, no window). Resolve against __dirname so it always finds the asar.
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'))
    .catch(err => console.error('[main] loadFile failed:', err));
  // Keep the build marker in the title bar even though index.html sets its own
  // <title> — this is how you confirm at a glance you launched the right copy.
  mainWin.webContents.on('page-title-updated', (e) => {
    e.preventDefault();
    mainWin.setTitle('NARIMAN');
  });

  // Show the window robustly. The window is created hidden and revealed once the
  // renderer is ready — but if that event is missed (a load failure on Windows,
  // etc.) the app would show in Task Manager with NO visible window. So reveal on
  // ready-to-show, ALSO on did-finish-load, ALSO on load failure (so the error is
  // visible), and finally on a last-resort timeout — never leave a ghost process.
  let _shown = false;
  const showWin = () => {
    if (_shown || !mainWin || mainWin.isDestroyed()) return;
    _shown = true;
    try { mainWin.maximize(); } catch (e) {}
    mainWin.show();
  };
  mainWin.once('ready-to-show', showWin);
  mainWin.webContents.once('did-finish-load', showWin);
  mainWin.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[main] did-fail-load:', code, desc, url);
    showWin();                                        // show so the failure is visible, not a ghost
    try { mainWin.webContents.openDevTools({ mode: 'detach' }); } catch (e) {}
  });
  setTimeout(showWin, 8000);                          // last resort

  // Log renderer crashes instead of silently dying
  mainWin.webContents.on('render-process-gone', (_e, details) => {
    console.error('Renderer crashed:', details.reason, details.exitCode);
  });
  mainWin.webContents.on('unresponsive', () => console.warn('Renderer unresponsive'));
}

app.whenReady().then(() => { registerMpProtocol(); createWindow(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Blade-pose inference: the renderer sends one window's raw RGBA pixels (a
// size*size*4 uint8 buffer). We resize→640, run the model (CPU), decode, and
// return the best detection's keypoints in CROP space (0..size), or null.
// Doing the resize+decode here keeps the UI thread free and shrinks the IPC
// payload ~12× vs. shipping the full float tensor. Errors → null so a missing
// model or bad frame never breaks the UI.
ipcMain.handle('blade-infer', async (_event, { blade, rgba, size, conf }) => {
  try {
    const sess = await getBladeSession(blade);
    const input = _bladeKit.rgbaCropToTensor(rgba, size);
    const t = new _ort.Tensor('float32', input, [1, 3, 640, 640]);
    const res = await sess.run({ [sess.inputNames[0]]: t });
    const out = res[sess.outputNames[0]].data; // Float32Array (11×8400)
    return _bladeKit.decodeToCrop(out, size, conf); // {conf, base:[x,y], dir:[x,y]} | null
  } catch (e) {
    console.error('[blade-infer] failed:', e.message);
    return null;
  }
});

// Warm up a blade session (create it) so the first real detection isn't slow.
ipcMain.handle('blade-warmup', async (_event, blade) => {
  try { await getBladeSession(blade); return true; } catch (e) { return false; }
});

// Open video file dialog — returns file:// URL safe for <video> src
ipcMain.handle('open-video', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Open Video',
    filters: [{ name: 'Video / Image', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'jpg', 'jpeg', 'png'] }],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return null;
  return 'file://' + filePaths[0];
});

// Detect fps by parsing mp4 container (moov/trak/mdhd) — returns raw float or null
ipcMain.handle('detect-fps', (_event, fileUrl) => {
  let filePath;
  try {
    filePath = decodeURIComponent(new URL(fileUrl).pathname);
    if (process.platform === 'win32') filePath = filePath.replace(/^\//, '');
  } catch (e) { return null; }
  return parseMp4Fps(filePath);
});

function parseMp4Fps(filePath) {
  const MAX_READ = 32 * 1024 * 1024; // stop after 32 MB (moov is near the start for web-optimised files)
  const CHUNK    = 512 * 1024;

  return new Promise((resolve) => {
    const mp4 = MP4Box.createFile();
    let settled = false;
    let fd = null;
    let timer = null;

    // Close the fd EXACTLY once and clear the timer. Closing a descriptor more
    // than once is catastrophic in Electron: the number gets recycled by
    // Chromium, and a second close kills Chromium's fd → SIGTRAP
    // (FATAL scoped_file.cc "Bad file descriptor"). All exit paths go through
    // done() → cleanup(), so the fd is only ever closed here.
    const cleanup = () => {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (fd !== null) { try { fs.closeSync(fd); } catch (e) {} fd = null; }
    };
    const done = (v) => { if (!settled) { settled = true; cleanup(); resolve(v); } };

    mp4.onReady = (info) => {
      const vt = (info.videoTracks || [])[0];
      done(vt && vt.duration > 0 ? (vt.nb_samples * vt.timescale / vt.duration) : null);
    };
    mp4.onError = () => done(null);

    let fileSize;
    try {
      fileSize = fs.statSync(filePath).size;
      fd = fs.openSync(filePath, 'r');
    } catch (e) { return done(null); }

    let offset = 0;
    const limit = Math.min(fileSize, MAX_READ);

    const pump = () => {
      if (settled) return;
      if (offset >= limit) { done(null); return; }
      const size = Math.min(CHUNK, limit - offset);
      const buf  = Buffer.alloc(size);
      let n;
      try { n = fs.readSync(fd, buf, 0, size, offset); }
      catch (e) { done(null); return; }
      if (n === 0) { done(null); return; }

      const ab = new ArrayBuffer(n);
      new Uint8Array(ab).set(buf.subarray(0, n));
      ab.fileStart = offset;
      offset += n;
      mp4.appendBuffer(ab);   // may fire onReady synchronously → done() → settled

      if (!settled) setImmediate(pump);
    };

    timer = setTimeout(() => done(null), 5000);
    pump();
  });
}

// Pick a log file path (for continuous auto-save log)
ipcMain.handle('pick-log-path', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Choose Log File',
    defaultPath: 'nariman_log.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  return canceled ? null : filePath;
});

// Write log file to a pre-chosen path (no dialog)
ipcMain.handle('write-log', async (_event, { path, content }) => {
  try { fs.writeFileSync(path, content, 'utf8'); return true; }
  catch(e) { return false; }
});

// Defaults to a file the user picks — returns the saved path (or null if cancelled)
ipcMain.handle('save-defs-file', async (_event, content) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save Defaults To File',
    defaultPath: 'defs.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return null;
  try { fs.writeFileSync(filePath, content, 'utf8'); return filePath; }
  catch(e) { return null; }
});

// Load defaults from a file the user picks — returns { path, content } or null
ipcMain.handle('load-defs-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Load Defaults From File',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths || !filePaths[0]) return null;
  try { return { path: filePaths[0], content: fs.readFileSync(filePaths[0], 'utf8') }; }
  catch(e) { return null; }
});

// ── Segment files (Range/Segments save/load layer) ─────────────────────────
// Create a new segment JSON via Save dialog; writes initial content, returns path.
ipcMain.handle('seg-create', async (_event, payload) => {
  const { content, defaultName } = (typeof payload === 'string') ? { content: payload, defaultName: null } : payload;
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Create Segment File',
    defaultPath: defaultName || 'segments.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return null;
  try { fs.writeFileSync(filePath, content, 'utf8'); return filePath; }
  catch (e) { return null; }
});

// Pick + read an existing segment file → { path, content } or null.
ipcMain.handle('seg-load', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Open Segment File',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths || !filePaths[0]) return null;
  try { return { path: filePaths[0], content: fs.readFileSync(filePaths[0], 'utf8') }; }
  catch (e) { return null; }
});

// Read a known segment file by path (for the dropdown) → content string or null.
ipcMain.handle('seg-read', async (_event, filePath) => {
  try { return fs.readFileSync(filePath, 'utf8'); } catch (e) { return null; }
});

// Atomic write to a known path (auto-save / manual save): temp file then rename.
ipcMain.handle('seg-write', async (_event, { path: filePath, content }) => {
  try {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, filePath);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Pick XLSX file path via dialog (used for first-time setup or "Change file")
ipcMain.handle('pick-xlsx-path', async (_event, defaultPath) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Choose Excel Export File',
    defaultPath: defaultPath || 'measurements.xlsx',
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
  });
  return canceled ? null : filePath;
});

// Save to Excel — appends a row to the subject's sheet (one sheet per subject,
// many rows = many trials). Creates the sheet/file if missing. xlsxPath is given
// directly (no dialog) so there is never an OS "Replace?" prompt.
// Duplicate guard: if the same Phase.Trial (row[0]) already exists in the sheet
// and `force` is not set, returns { duplicate: true } so the renderer can warn.
ipcMain.handle('save-excel', async (_event, { xlsxPath, sheetName, headers, row, force }) => {
  const XLSX = require('xlsx');
  if (!xlsxPath) return { ok: false, error: 'No file path provided' };

  let wb;
  if (fs.existsSync(xlsxPath)) {
    try { wb = XLSX.readFile(xlsxPath); }
    catch(e) { wb = XLSX.utils.book_new(); }
  } else {
    wb = XLSX.utils.book_new();
  }

  if (wb.SheetNames.includes(sheetName)) {
    // Existing subject sheet → append under the current rows
    const ws  = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
    if (aoa.length === 0) aoa.push(headers);
    // Duplicate Phase.Trial check (first column), skipping the header row
    const dup = aoa.slice(1).some(r => String(r[0]) === String(row[0]) && String(r[r.length - 1]) === String(row[row.length - 1]));
    if (dup && !force) return { ok: false, duplicate: true, sheetName };
    aoa.push(row);
    wb.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(aoa);
  } else {
    // New subject → fresh sheet with header + first row
    const ws = XLSX.utils.aoa_to_sheet([headers, row]);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  try {
    XLSX.writeFile(wb, xlsxPath);
    return { ok: true, filePath: xlsxPath };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// Save CSV/XLSX export — writes to disk, returns saved path
ipcMain.handle('save-export', async (_event, { csv, filename }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Measurements',
    defaultPath: filename,
    filters: [
      { name: 'CSV', extensions: ['csv'] },
      { name: 'Excel', extensions: ['xlsx'] },
    ],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, csv, 'utf8');
  return filePath;
});

ipcMain.handle('confirm-keep', async (_event, message) => {
  const { response } = await dialog.showMessageBox({
    type: 'question', message, buttons: ['Keep', "Don't Keep"], defaultId: 0, cancelId: 1,
  });
  return response === 0; // true = Keep
});

ipcMain.handle('save-media', async (_event, { data, ext, defaultName }) => {
  const isImg = ext === 'png';
  const { filePath } = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: isImg
      ? [{ name: 'PNG Image', extensions: ['png'] }]
      : [{ name: 'Video', extensions: [ext === 'mp4' ? 'mp4' : 'webm'] }, { name: 'All Files', extensions: ['*'] }],
  });
  if (!filePath) return { ok: false };
  try { fs.writeFileSync(filePath, Buffer.from(data)); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ── Audio scan IPC ────────────────────────────────────────────────────────
// Pause/resume: renderer calls audio-scan-cancel to set aborted flag;
// scan loop saves partial transcript with processedCount then returns paused:true.
// Next audio-scan call detects processedCount < vadSegments.length and resumes.
let scanController = null;

ipcMain.handle('audio-scan-cancel', () => {
  if (scanController) scanController.aborted = true;
  return { ok: true };
});

ipcMain.handle('audio-scan', async (event, { videoUrl, existingTranscript, sensitivity = 'default' }) => {
  scanController = { aborted: false };

  let videoPath;
  try {
    videoPath = decodeURIComponent(new URL(videoUrl).pathname);
    if (process.platform === 'win32') videoPath = videoPath.replace(/^\//, '');
  } catch { return { ok: false, error: 'Cannot resolve video path from URL' }; }

  const audioPath      = videoPath + '.omsni.wav';
  const transcriptPath = audioPath + '.transcript.json';
  let transcript = null;

  // Prefer transcript from renderer (stored in segment JSON) over the sidecar file
  const isValidTranscript = t => t && (t.version ?? 0) >= 2 &&
    (t.processedCount > 0 || (t.words?.length > 0) || (t.segments?.length > 0));

  if (isValidTranscript(existingTranscript)) {
    transcript = existingTranscript;
  } else if (fs.existsSync(transcriptPath)) {
    // Fallback for users who have an existing sidecar file but no segment JSON transcript yet
    try { transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf8')); } catch {}
    if (transcript && !isValidTranscript(transcript)) transcript = null;
  }

  // mergedGroups is the unit of resumption; its length is what processedCount tracks
  let vadSegs, mergedGroups;
  const isComplete = transcript && (transcript.processedCount ?? 0) >= (transcript.mergedCount ?? 0) && transcript.mergedCount > 0;

  if (!isComplete) {
    const ffmpegBin  = getBinPath('ffmpeg');
    const whisperBin = getBinPath('whisper');
    const model      = getModelPath();
    const platArch   = (process.platform === 'darwin' ? 'mac' : 'win') + '-' + process.arch;
    if (!fs.existsSync(ffmpegBin))  return { ok: false, error: `ffmpeg not found — place it in resources/bin/${platArch}/ffmpeg` };
    if (!fs.existsSync(whisperBin)) return { ok: false, error: `whisper not found — place it in resources/bin/${platArch}/whisper` };
    if (!fs.existsSync(model))      return { ok: false, error: 'Whisper model not found at: ' + model };

    if (!transcript) {
      // Fresh run — extract audio then VAD
      if (!fs.existsSync(audioPath)) {
        event.sender.send('audio-progress', { pct: 0, msg: 'Extracting audio (16 kHz mono)…' });
        const ext = await new Promise(resolve => {
          const args = ['-y', '-i', videoPath, '-vn', '-ar', '16000', '-ac', '1', '-f', 'wav', audioPath];
          const proc = spawn(ffmpegBin, args);
          let stderr = '';
          proc.stderr.on('data', d => { stderr += d; });
          proc.on('close', code => resolve(code === 0 ? { ok: true } : { ok: false, error: stderr.slice(-300) }));
          proc.on('error', e => resolve({ ok: false, error: e.message }));
        });
        if (!ext.ok) return { ok: false, error: 'Audio extraction failed: ' + ext.error };
      }
      event.sender.send('audio-progress', { pct: 5, msg: 'Detecting speech regions…' });
      try { vadSegs = wavVAD(audioPath, sensitivity); } catch (e) { return { ok: false, error: 'VAD error: ' + e.message }; }
      if (!vadSegs.length) return { ok: true, transcript: null, audioPath, paused: false };
      mergedGroups = mergeVADSegments(vadSegs, 3.0, 30);
      transcript = { version: 2, audioPath, createdAt: new Date().toISOString(), vadSegments: vadSegs, mergedCount: mergedGroups.length, words: [], segments: [], processedCount: 0 };
    } else {
      vadSegs = transcript.vadSegments;
      mergedGroups = mergeVADSegments(vadSegs, 3.0, 30); // recompute from saved VAD for resume
    }

    const startFrom = transcript.processedCount ?? 0;
    const allWords  = [...(transcript.words  ?? [])];
    const allSegs   = [...(transcript.segments ?? [])];

    event.sender.send('audio-progress', {
      pct: 10 + Math.round(startFrom / mergedGroups.length * 85),
      msg: startFrom > 0 ? `Resuming from ${startFrom + 1}/${mergedGroups.length}…` : `${mergedGroups.length} chunks (merged from ${vadSegs.length} segments). Running Whisper…`,
    });

    for (let i = startFrom; i < mergedGroups.length; i++) {
      if (scanController.aborted) {
        transcript = { ...transcript, words: allWords, segments: allSegs, processedCount: i };
        const pct = 10 + Math.round(i / mergedGroups.length * 85);
        event.sender.send('audio-progress', { pct, msg: `Paused at ${i}/${mergedGroups.length} — click Resume to continue.` });
        return { ok: true, transcript, audioPath, paused: true };
      }

      const { startSec, endSec } = mergedGroups[i];
      const tmpPath = path.join(os.tmpdir(), `omsni_${i}_${Date.now()}.wav`);
      event.sender.send('audio-progress', { pct: 10 + Math.round(i / mergedGroups.length * 85), msg: `Transcribing ${i + 1}/${mergedGroups.length}  (${startSec.toFixed(1)}s – ${endSec.toFixed(1)}s)` });
      try {
        await extractChunk(ffmpegBin, audioPath, startSec, endSec - startSec, tmpPath);
        const { words, segments } = await runWhisper(whisperBin, model, tmpPath, startSec, sensitivity);
        allWords.push(...words); allSegs.push(...segments);
      } catch (e) {
        event.sender.send('audio-progress', { pct: 10 + Math.round(i / mergedGroups.length * 85), msg: `Chunk ${i + 1} failed: ${e.message} — skipping` });
      } finally {
        try { fs.unlinkSync(tmpPath); } catch {}
      }
    }

    transcript = { ...transcript, words: allWords, segments: allSegs, processedCount: mergedGroups.length };
    event.sender.send('audio-progress', { pct: 100, msg: `Done — ${allWords.length} words, ${allSegs.length} segments.` });
  } else {
    event.sender.send('audio-progress', { pct: 100, msg: `Transcript loaded (${transcript.words.length} words, ${transcript.segments.length} segments).` });
  }

  return { ok: true, transcript, audioPath, paused: false };
});
