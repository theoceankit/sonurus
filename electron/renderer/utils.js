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

function speakerColorIndex(spkId) {
  let h = 0
  for (let i = 0; i < spkId.length; i++) h = (Math.imul(31, h) + spkId.charCodeAt(i)) | 0
  return Math.abs(h) % SPEAKER_PALETTE.length
}

function speakerPalette(spkId) {
  return SPEAKER_PALETTE[speakerColorIndex(spkId)]
}

function speakerInitials(name) {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUnrecognized(spkId, knownMap = null) {
  if (spkId.startsWith('SPEAKER_')) return true
  if (knownMap !== null) return !(spkId in knownMap)
  // Fallback: both legacy spk_* and new full UUIDs are unrecognized without knownMap
  return spkId.startsWith('spk_') || _UUID_RE.test(spkId)
}

function effectiveSpeaker(seg) {
  return seg.speaker_final || seg.speaker_resolved || seg.speaker_raw || '?'
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ── Avatar ──────────────────────────────────────────────────────────────────────
function makeAvatar(spkId, displayName, size = 24, knownMap = null) {
  const el = document.createElement('div')
  el.className = 'spk-avatar'
  el.style.width = el.style.height = size + 'px'
  el.style.fontSize = Math.round(size * 0.38) + 'px'

  if (isUnrecognized(spkId, knownMap)) {
    el.classList.add('spk-avatar--unknown')
    el.textContent = '?'
  } else {
    const p = speakerPalette(spkId)
    el.style.background = p.color
    el.textContent = speakerInitials(displayName)
  }
  return el
}
