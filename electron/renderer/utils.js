// ── API endpoints ───────────────────────────────────────────────────────────────
const API_BASE = 'http://localhost:8000'
const WS_BASE  = 'ws://localhost:8000'

// ── Speaker palette ─────────────────────────────────────────────────────────────
const SPEAKER_PALETTE = [
  { color: '#5B8A72', bg: '#E6EDE7' },
  { color: '#C56E5A', bg: '#F4E5DF' },
  { color: '#5670A6', bg: '#E4E8F1' },
  { color: '#B58A3A', bg: '#F0E7D3' },
  { color: '#7B6DB5', bg: '#EBE9F4' },
]

// Recognized speakers keyed by id, from GET /speakers rows:
// { [id]: { name, colorIndex } }. The one shape used across the renderer.
function buildKnownMap(speakers) {
  const map = {}
  speakers.forEach(s => { map[s.id] = { name: s.name, colorIndex: s.color_index ?? 0 } })
  return map
}

function speakerPalette(spkId, knownMap = {}) {
  const idx = (knownMap[spkId]?.colorIndex ?? 0) % SPEAKER_PALETTE.length
  return SPEAKER_PALETTE[idx]
}

function speakerInitials(name) {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Recognized = has a display name, i.e. is present in knownMap (built from
// GET /speakers, which lists named speakers only). Raw SPEAKER_* labels never are.
function isUnrecognized(spkId, knownMap = {}) {
  return spkId.startsWith('SPEAKER_') || !(spkId in knownMap)
}

function effectiveSpeaker(seg) {
  return seg.speaker_final || seg.speaker_resolved || seg.speaker_raw || '?'
}

// Filesystem path → file:// URL. Every path segment is percent-encoded so
// spaces, non-ASCII, '#' and '?' survive; Windows drive letters are kept.
function fileUrl(fsPath) {
  const segments = fsPath.replace(/\\/g, '/').split('/')
  const encoded = segments.map(s => /^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s)).join('/')
  return 'file://' + (encoded.startsWith('/') ? encoded : '/' + encoded)
}

// Last path component of a POSIX or Windows path.
function fileBaseName(fsPath) {
  return fsPath.split(/[\\/]/).pop()
}

// System-audio source options for the recording UI: [{ value, label }].
// Windows: captured in the renderer (WASAPI loopback via Electron's display
// media handler) plus any virtual loopback inputs the browser exposes.
// macOS/Linux: captured by the backend (GET /audio/capture/sources).
async function listSystemAudioSources(platform, audioInputs) {
  if (platform === 'win32') {
    return [
      { value: '__desktop__', label: 'System audio (WASAPI)' },
      ...audioInputs
        .filter(d => /virtual|loopback|system|output|mix|monitor/i.test(d.label))
        .map(d => ({ value: d.deviceId, label: d.label })),
    ]
  }
  try {
    const r = await fetch(`${API_BASE}/audio/capture/sources`)
    if (!r.ok) return []
    const { sources } = await r.json()
    return sources.map(s => ({ value: s.id, label: s.label }))
  } catch (_) {
    return []
  }
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ── Avatar ──────────────────────────────────────────────────────────────────────
function makeAvatar(spkId, displayName, size = 24, knownMap = {}) {
  const el = document.createElement('div')
  el.className = 'spk-avatar'
  el.style.width = el.style.height = size + 'px'
  el.style.fontSize = Math.round(size * 0.38) + 'px'

  if (isUnrecognized(spkId, knownMap)) {
    el.classList.add('spk-avatar--unknown')
    el.textContent = '?'
  } else {
    const p = speakerPalette(spkId, knownMap)
    el.style.background = p.color
    el.textContent = speakerInitials(displayName)
  }
  return el
}

// ── Settings / data reset ───────────────────────────────────────────────────────
// Patch that restores every preference to its default; the Hugging Face token
// is a credential, not a preference, so it is kept.
function defaultSettingsPatch(defaults, current) {
  return { ...defaults, hfToken: current.hfToken ?? defaults.hfToken }
}

// Why "Delete all data" must stay disabled right now, or null if it may run.
function dataResetBlockReason(activeJobCount, liveSession) {
  if (activeJobCount > 0) return 'Wait for the running transcription to finish.'
  if (liveSession) return 'Stop the live recording first.'
  return null
}

function formatDataResetSummary({ transcripts, speakers, files }) {
  if (!transcripts && !speakers && !files) return 'There was no data to delete.'
  const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`
  return `Deleted ${n(transcripts, 'transcript')}, ${n(speakers, 'speaker')} and ${n(files, 'file')}.`
}
