#!/usr/bin/env node
'use strict'

// Proves that the bundled backend still imports after the installer left out
// EXCLUDED_PACKAGES (scripts/lock-backend.js) and the files pruned by
// scripts/bundle-backend.js: the bundled interpreter imports the backend and
// the pipeline libraries, none of the excluded packages is installed, and
// third-party telemetry is switched off (app/__init__.py), and NLTK's punkt_tab
// data for alignment loads from python-dist/nltk_data.
// Imports done lazily inside functions (when models load) are not covered;
// a transcription on a built app covers those.
//
// Run after bundling:  node scripts/check-bundled-imports.js [backend-dist]

const fs            = require('fs')
const os            = require('os')
const path          = require('path')
const { spawnSync } = require('child_process')
const { pythonLayout }      = require('./bundle-backend')
const { EXCLUDED_PACKAGES } = require('./lock-backend')

// The API, the pipeline child process and the libraries it runs.
const BUNDLED_IMPORTS = [
  'app.api.main',
  'app.services.service_factory',
  'app.services.pipeline_process',
  'app.services.transcription_service',
  'app.services.embedding_service',
  'app.gpu_probe',
  'whisperx',
  'whisperx.asr',
  'whisperx.alignment',
  'whisperx.diarize',
  'faster_whisper',
  'pyannote.audio',
  'pyannote.audio.pipelines.speaker_diarization',
  'pyannote.audio.pipelines.speaker_verification',
]

// Python run by the bundled interpreter; sys.argv[1] is the backend directory.
function checkSource() {
  return [
    'import importlib, importlib.metadata, sys',
    'sys.path.insert(0, sys.argv[1])',
    `for name in ${JSON.stringify(BUNDLED_IMPORTS)}:`,
    '    importlib.import_module(name)',
    `found = []`,
    `for name in ${JSON.stringify(EXCLUDED_PACKAGES)}:`,
    '    try:',
    '        importlib.metadata.distribution(name)',
    '        found.append(name)',
    '    except importlib.metadata.PackageNotFoundError:',
    '        pass',
    'if found:',
    '    sys.exit("excluded packages are installed: " + ", ".join(found))',
    // Third-party telemetry is switched off by app/__init__.py (imported above).
    'import os',
    'from pyannote.audio.telemetry.metrics import is_metrics_enabled',
    'from huggingface_hub import constants',
    'if is_metrics_enabled() or os.environ.get("OTEL_SDK_DISABLED") != "true" or not constants.HF_HUB_DISABLE_TELEMETRY:',
    '    sys.exit("third-party telemetry is not switched off")',
    // The pipeline process calls it; fails if onnxruntime drops the switch.
    'import app; app.disable_onnxruntime_telemetry()',
    // Alignment's sentence data loads offline, for every language WhisperX maps.
    'from app.nltk_data import use_bundled_nltk_data; use_bundled_nltk_data()',
    'import nltk.data',
    'from whisperx.utils import PUNKT_LANGUAGES',
    'for lang in sorted(set(PUNKT_LANGUAGES.values())):',
    '    nltk.data.load(f"tokenizers/punkt_tab/{lang}.pickle")',
    `print("bundled imports ok (${BUNDLED_IMPORTS.length} modules)")`,
  ].join('\n')
}

module.exports = { BUNDLED_IMPORTS, checkSource }

if (require.main === module) {
  const backend = path.resolve(process.argv[2] || path.join(__dirname, '..', 'backend-dist'))
  const { exe } = pythonLayout(path.join(backend, 'python-dist'))
  if (!fs.existsSync(exe)) {
    console.error(`No bundled Python at ${exe} (run node scripts/bundle-backend.js)`)
    process.exit(1)
  }
  // Importing app.config resolves the data dir; keep it out of the repository.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-import-check-'))
  try {
    const res = spawnSync(exe, ['-I', '-c', checkSource(), backend], {
      cwd: dataDir,
      env: { ...process.env, SONORUS_DATA_DIR: dataDir },
      stdio: 'inherit',
    })
    if (res.error) throw res.error
    if (res.status !== 0) console.error('::error::the bundled backend check failed')
    process.exitCode = res.status ?? 1
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}
