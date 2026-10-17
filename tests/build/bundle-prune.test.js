'use strict'

// The bundled Python leaves out what the backend never runs: library test
// suites, torch's C++ headers and test programs (scripts/bundle-backend.js),
// and the packages listed in EXCLUDED_PACKAGES (scripts/lock-backend.js).
// scripts/check-bundled-imports.js proves on the built interpreter that the
// backend still imports. These tests guard the pruning and that check.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const os     = require('os')
const path   = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { pruneSitePackages } = require(path.join(ROOT, 'scripts', 'bundle-backend.js'))
const { EXCLUDED_PACKAGES } = require(path.join(ROOT, 'scripts', 'lock-backend.js'))
const imports = require(path.join(ROOT, 'scripts', 'check-bundled-imports.js'))

function tree(root, files) {
  for (const rel of files) {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'x'.repeat(1000))
  }
}

const exists = (root, rel) => fs.existsSync(path.join(root, rel))

test('pruneSitePackages removes test suites, torch headers and torch test programs', () => {
  const sp = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-prune-'))
  try {
    tree(sp, [
      'numpy/__init__.py',
      'numpy/tests/test_a.py',
      'numpy/_core/tests/test_b.py',
      'numpy/testing/__init__.py',
      'nltk/test/unit.py',
      'scipy/stats/tests/data/x.csv',
      'torch/__init__.py',
      'torch/test/basic',
      'torch/include/c10/core/Device.h',
      'torch/testing/__init__.py',
      'torch/lib/libtorch_cpu.so',
      'torch/bin/torch_shm_manager',
      'torch/bin/protoc',
      'torch/bin/protoc-3.13.0.0',
      'torch/bin/test_api',
      'torch/bin/FileStoreTest',
      'torch/bin/tutorial_tensorexpr',
      'pip/__init__.py',
    ])
    const removed = pruneSitePackages(sp)
    for (const gone of [
      'numpy/tests', 'numpy/_core/tests', 'nltk/test', 'scipy/stats/tests',
      'torch/test', 'torch/include',
      'torch/bin/protoc', 'torch/bin/protoc-3.13.0.0', 'torch/bin/test_api',
      'torch/bin/FileStoreTest', 'torch/bin/tutorial_tensorexpr',
    ]) assert.ok(!exists(sp, gone), `${gone} must be removed`)
    for (const kept of [
      'numpy/__init__.py', 'numpy/testing/__init__.py', 'torch/__init__.py',
      'torch/testing/__init__.py', 'torch/lib/libtorch_cpu.so', 'torch/bin/torch_shm_manager',
      'pip/__init__.py',
    ]) assert.ok(exists(sp, kept), `${kept} must stay`)
    assert.equal(removed, 11 * 1000, 'returns the bytes removed')
  } finally {
    fs.rmSync(sp, { recursive: true, force: true })
  }
})

test('pruneSitePackages tolerates a tree without torch', () => {
  const sp = fs.mkdtempSync(path.join(os.tmpdir(), 'sonorus-prune-'))
  try {
    tree(sp, ['six.py'])
    assert.equal(pruneSitePackages(sp), 0)
    assert.ok(exists(sp, 'six.py'))
  } finally {
    fs.rmSync(sp, { recursive: true, force: true })
  }
})

test('import check covers the pipeline and every excluded package', () => {
  for (const mod of [
    'app.api.main', 'app.services.service_factory', 'app.services.pipeline_process',
    'app.services.transcription_service', 'app.services.embedding_service', 'app.gpu_probe',
    'whisperx.asr', 'whisperx.alignment', 'whisperx.diarize',
    'pyannote.audio', 'pyannote.audio.pipelines.speaker_diarization',
  ]) assert.ok(imports.BUNDLED_IMPORTS.includes(mod), `${mod} must be imported`)
  const src = imports.checkSource()
  for (const mod of imports.BUNDLED_IMPORTS) assert.ok(src.includes(JSON.stringify(mod)), mod)
  for (const name of EXCLUDED_PACKAGES) assert.ok(src.includes(JSON.stringify(name)), name)
})

test('import check proves the bundled backend has third-party telemetry off', () => {
  const src = imports.checkSource()
  assert.ok(src.includes('is_metrics_enabled()'), 'pyannote metrics must be checked')
  assert.ok(src.includes('HF_HUB_DISABLE_TELEMETRY'), 'Hugging Face telemetry must be checked')
  assert.ok(src.includes('OTEL_SDK_DISABLED'), 'the OpenTelemetry SDK must be checked')
  assert.ok(src.includes('app.disable_onnxruntime_telemetry()'), 'the onnxruntime switch must be checked')
})

test('every installer build checks the bundled imports right after bundling', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'build.yml'), 'utf8')
  const bundles = wf.match(/run: node scripts\/bundle-backend\.js\n\s+- name: [^\n]+\n\s+run: node scripts\/check-bundled-imports\.js/g) || []
  assert.equal(bundles.length, 3)
  assert.equal((wf.match(/run: node scripts\/bundle-backend\.js/g) || []).length, 3)
})
