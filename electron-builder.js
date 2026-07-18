// Per-arch build config. Set BUILD_ARCH=x64|ia32 before building Windows.
// Mac always builds universal (arm64 + x64 in one DMG).
const fs = require('fs');
const path = require('path');
const winArch = process.env.BUILD_ARCH || 'x64';

// OPTIONAL: bundle the Microsoft Visual C++ runtime DLLs so onnxruntime (blade
// inference) never depends on the target Windows having them installed. Drop
// vcruntime140.dll / vcruntime140_1.dll / msvcp140.dll into
// resources/win-vcruntime/<arch>/ (e.g. .../x64/). If that folder is absent the
// build proceeds without them (as before). main.js adds this 'vcruntime' folder
// to the DLL search path at runtime.
const _winExtra = [ { from: `resources/bin/win-${winArch}`, to: `bin/win-${winArch}` } ];
const _vcDir = path.join(__dirname, 'resources', 'win-vcruntime', winArch);
if (fs.existsSync(_vcDir)) _winExtra.push({ from: `resources/win-vcruntime/${winArch}`, to: 'vcruntime', filter: ['*.dll'] });

module.exports = {
  appId: 'com.nariman.app',
  productName: 'NARIMAN',

  // onnxruntime-node ships a native .node addon (+ shared libs) that cannot be
  // loaded from inside the asar archive — keep it unpacked on disk.
  asarUnpack: ['**/node_modules/onnxruntime-node/**'],

  files: [
    '**/*',
    '!resources/**',        // bins + model go via extraResources, never into asar
    '!omsni_defs*.json',
    '!*.csv',
    '!*.xlsx',
    '!dist/**',
    '!source.zip',
    '!blade_test/**',
    '!pose_test/**',
    '!.Rhistory',
    '!**/.DS_Store',
    '!.gitignore',
    '!package-lock.json',
    '!electron-builder.js',
    // Dev-only helpers / backups — never ship them.
    '!blade_measure.py',
    '!blade_measure_log.txt',
    '!**/*.bak',
    '!**/*.bak_*',
  ],

  // Speech + blade model files shared by all platforms. The filter keeps the
  // needed weights (blade{1,2,3}.onnx, the speech model) but drops backup copies
  // (*.bak, *.bak_pre_lsd) and junk so they never bloat the shipped app.
  extraResources: [
    { from: 'resources/models', to: 'models',
      filter: ['**/*', '!**/*.bak', '!**/*.bak_*', '!**/.DS_Store', '!**/.gitkeep'] },
  ],

  mac: {
    target: [
      { target: 'dmg', arch: ['universal'] },
      { target: 'zip', arch: ['universal'] },
    ],
    // These files are byte-identical in the x64-temp and arm64-temp slices, so
    // tell @electron/universal to just copy them from x64 instead of trying to
    // lipo/merge them: our extraResources (bin, models) AND onnxruntime-node's
    // prebuilt native binaries, which ship ALL arches in BOTH slices and live
    // under app.asar.unpacked (that last one is what the build was erroring on).
    x64ArchFiles: 'Contents/Resources/{bin,models,app.asar.unpacked}/**',
    // Universal needs both slices so the runtime can pick by process.arch
    extraResources: [
      { from: 'resources/bin/mac-arm64', to: 'bin/mac-arm64' },
      { from: 'resources/bin/mac-x64',   to: 'bin/mac-x64'   },
    ],
  },

  win: {
    signExecutable: false,
    target: [{ target: 'portable', arch: [winArch] }],
    // Matching-arch bin (+ optional VC++ runtime DLLs — see _winExtra above).
    extraResources: _winExtra,
  },

  portable: {
    artifactName: '${productName}-${version}-${arch}-Portable.${ext}',
  },
};
