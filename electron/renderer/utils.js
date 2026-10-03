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

// Effective speaker of a segment whose speaker was deleted (see Segment.unassigned).
const UNASSIGNED_ID = 'UNASSIGNED'

// Recognized (named) speakers keyed by id, from GET /speakers rows:
// { [id]: { name, colorIndex } }. The one shape used across the renderer.
function buildKnownMap(speakers) {
  const map = {}
  speakers.forEach(s => { if (s.name) map[s.id] = { name: s.name, colorIndex: s.color_index ?? 0 } })
  return map
}

// GET /speakers rows that have a display name — what the editor offers.
function namedSpeakers(speakers) {
  return speakers.filter(s => s.name)
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
// the named GET /speakers rows). Raw SPEAKER_* labels and UNASSIGNED never are.
function isUnrecognized(spkId, knownMap = {}) {
  return spkId.startsWith('SPEAKER_') || !(spkId in knownMap)
}

function effectiveSpeaker(seg) {
  if (seg.unassigned) return UNASSIGNED_ID
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

// Uploads a finished live recording; the backend stores it in its own
// recordings dir (it alone writes there) and returns the file path.
async function uploadRecording(blob) {
  const r = await fetch(`${API_BASE}/audio/recordings`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type },
    body: blob,
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.detail || 'Failed to save the recording.')
  return data.file_path
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ── Avatar ──────────────────────────────────────────────────────────────────────
// Every speaker avatar in the UI comes from here (docs: ui/electron/components/speaker-avatar).
// Size is a preset; its circle and font live in CSS (.spk-avatar--<size>).
const AVATAR_SIZES = ['xs', 'sm', 'md', 'lg']

function _avatarElement(size) {
  if (!AVATAR_SIZES.includes(size)) throw new Error(`Unknown avatar size: ${size}`)
  const el = document.createElement('div')
  el.className = `spk-avatar spk-avatar--${size}`
  return el
}

function setAvatarName(el, name, color) {
  const trimmed = name.trim()
  el.textContent = trimmed ? speakerInitials(trimmed) : ''
  el.style.background = color
}

// Avatar for a name that has no speaker id yet (New speaker preview).
function makeNameAvatar(name, color, size = 'md') {
  const el = _avatarElement(size)
  setAvatarName(el, name, color)
  return el
}

function makeAvatar(spkId, displayName, size = 'md', knownMap = {}) {
  if (!isUnrecognized(spkId, knownMap)) {
    return makeNameAvatar(displayName, speakerPalette(spkId, knownMap).color, size)
  }
  const el = _avatarElement(size)
  el.classList.add('spk-avatar--unknown')
  el.textContent = '?'
  return el
}

// Overlapping avatars; the first one is on top. The ring color comes from
// --avatar-ring set by the container.
function makeAvatarStack(spkIds, size, knownMap, { max = spkIds.length, nameOf = id => id, titles = false } = {}) {
  const stack = document.createElement('div')
  stack.className = 'spk-avatar-stack'
  const shown = spkIds.slice(0, max)
  shown.forEach((spkId, i) => {
    const av = makeAvatar(spkId, nameOf(spkId), size, knownMap)
    av.style.zIndex = shown.length - i
    if (titles) av.title = nameOf(spkId)
    stack.appendChild(av)
  })
  return stack
}

// ── Settings / data reset ───────────────────────────────────────────────────────
// Patch that restores every preference to its default; the Hugging Face token
// is a credential, not a preference, so it is kept.
function defaultSettingsPatch(defaults, current) {
  return { ...defaults, hfToken: current.hfToken ?? defaults.hfToken }
}

// Why "Delete all data" must stay disabled right now, or null if it may run.
function dataResetBlockReason(runningJobCount, liveSession) {
  if (runningJobCount > 0) return 'Pause the transcription queue first.'
  if (liveSession) return 'Stop the live recording first.'
  return null
}

function formatDataResetSummary({ transcripts, speakers, files }) {
  if (!transcripts && !speakers && !files) return 'There was no data to delete.'
  const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`
  return `Deleted ${n(transcripts, 'transcript')}, ${n(speakers, 'speaker')} and ${n(files, 'file')}.`
}

// Version line at the bottom of Settings; the version comes from package.json.
function formatAppVersion(version) {
  const v = typeof version === 'string' ? version.trim() : ''
  return v && v !== 'unknown' ? `Sonorus ${v}` : 'Sonorus'
}

// ── Sidebar: delete transcript ──────────────────────────────────────────────────
function withoutRecording(items, id) {
  return items.filter(r => r.id !== id)
}

function deleteTranscriptPrompt(title) {
  return {
    title: title ? `Delete “${title}”?` : 'Delete this transcript?',
    body: 'The transcript and its recording made in Sonorus will be deleted. '
      + 'Imported audio files are kept. This cannot be undone.',
  }
}

// ── Editor: rename transcript ───────────────────────────────────────────────────
const TITLE_MAX_LENGTH = 200 // TranscriptUpdateRequest.title max_length

// The title to send, or null when there is nothing valid to save
// (blank, unchanged, or over the server limit).
function titleToSave(raw, current) {
  const title = (raw || '').trim()
  if (!title || title === current || title.length > TITLE_MAX_LENGTH) return null
  return title
}

function transcriptTitleRequest(transcriptId, title) {
  return { url: `${API_BASE}/transcripts/${transcriptId}`, method: 'PATCH', body: { title } }
}

// ── Import: file drop ───────────────────────────────────────────────────────────
// Same list as the file dialog filter in electron/main.js (open-file).
const SUPPORTED_AUDIO_EXTENSIONS = ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'mp4', 'mkv', 'webm']

function isSupportedAudio(name) {
  const m = /\.([^./\\]+)$/.exec(name || '')
  return !!m && SUPPORTED_AUDIO_EXTENSIONS.includes(m[1].toLowerCase())
}

// Files dropped on the window. Settings and Speakers ignore them, an open
// modal handles its own drop. A live recording does not block imports: it
// pauses the transcription queue, so the files just wait.
function dropDecision({ view, modalOpen, files }) {
  if (view !== 'import' && view !== 'editor') return { action: 'ignore' }
  if (modalOpen) return { action: 'ignore' }
  const supported = files.filter(file => isSupportedAudio(file.name))
  return { action: 'import', files: supported, skipped: files.length - supported.length }
}

// Files dropped on the New Recording modal or picked in its file dialog →
// queue items. One file keeps the modal title unless it is the untouched
// default; several files, like a blank title, get no title, so the backend
// uses each file name.
function modalImportItems(paths, { title = '', titleIsDefault = false } = {}) {
  const supported = paths.filter(p => isSupportedAudio(fileBaseName(p)))
  const typed = titleIsDefault ? null : (title || '').trim() || null
  return {
    items: supported.map(filePath => ({ filePath, title: supported.length === 1 ? typed : null })),
    skipped: paths.length - supported.length,
  }
}

function importStartToast(paths) {
  return paths.length === 1 ? `Importing ${fileBaseName(paths[0])}…` : `Importing ${paths.length} files…`
}

function skippedFilesToast(count) {
  return `Skipped ${count} unsupported file${count === 1 ? '' : 's'}`
}

// Adds a job to the transcription queue. No title → the backend uses the
// file name.
function importRequest(filePath, { model, language, title = null }) {
  return {
    url: `${API_BASE}/queue/jobs`,
    method: 'POST',
    body: {
      audio_path: filePath,
      whisper_model: model,
      language: language === 'auto' ? null : language,
      title: (title || '').trim() || null,
    },
  }
}

// ── Transcription queue (snapshot from WS /ws/queue) ────────────────────────────

function queueJobCount(snapshot) {
  return snapshot ? snapshot.jobs.length : 0
}

function queueStateLabel(snapshot) {
  if (!snapshot.paused) return 'Running'
  return snapshot.paused_by_recording ? 'Paused while recording' : 'Paused'
}

// The header button. Start is allowed during a recording too (user's choice).
function queueToggle(snapshot) {
  return snapshot.paused
    ? { action: 'start', label: 'Start', icon: 'play' }
    : { action: 'pause', label: 'Pause', icon: 'pause' }
}

function jobStatusText(job, snapshot) {
  if (job.status === 'running') return snapshot.step || 'Starting…'
  if (job.status === 'failed') {
    if (job.error_code === 'alignment_model_missing')
      return `Alignment model for "${job.error_language}" is not installed`
    if (job.error_code === 'whisper_model_missing')
      return `Whisper model "${job.whisper_model}" is not installed`
    if (job.error_code === 'diarization_model_missing')
      return 'Diarization model is not installed'
    return (job.error || '').split('\n')[0].trim() || 'Failed'
  }
  return snapshot.paused ? 'Waiting · queue paused' : 'Waiting'
}

function deleteJobPrompt(job) {
  const isImport = fileBaseName(job.audio_path).startsWith('sonorus-import-')
  return {
    title: `Delete “${job.title}”?`,
    body: isImport
      ? 'The job and the app’s copy of the file will be deleted. Your original file is kept.'
      : 'The recording will be deleted. This cannot be undone.',
  }
}

// Title, model and language can be changed on every job except the running one.
function canEditJob(job) {
  return job.status !== 'running'
}

// { patch } with only the changed fields (null when nothing changed), or
// { error }. form.language 'auto' = auto-detect = null on the job.
function jobEditPatch(job, form) {
  const title = (form.title || '').trim()
  if (!title) return { error: 'Title cannot be empty.' }
  if (title.length > TITLE_MAX_LENGTH) return { error: `Title is longer than ${TITLE_MAX_LENGTH} characters.` }
  const language = form.language === 'auto' ? null : form.language
  const patch = {}
  if (title !== job.title) patch.title = title
  if (form.model !== job.whisper_model) patch.whisper_model = form.model
  if (language !== job.language) patch.language = language
  return { patch: Object.keys(patch).length ? patch : null }
}

function jobEditRequest(jobId, patch) {
  return { url: `${API_BASE}/queue/jobs/${jobId}`, method: 'PATCH', body: patch }
}

// New order after dropping draggedId before / after targetId.
function reorderJobIds(ids, draggedId, targetId, place) {
  if (draggedId === targetId || !ids.includes(draggedId) || !ids.includes(targetId)) return [...ids]
  const rest = ids.filter(id => id !== draggedId)
  const at = rest.indexOf(targetId) + (place === 'after' ? 1 : 0)
  return [...rest.slice(0, at), draggedId, ...rest.slice(at)]
}

// Where a dragged card lands relative to the card under the pointer.
function dropPlace(rect, clientY) {
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

// ── Speakers section ────────────────────────────────────────────────────────────
function _nameKey(name) {
  return (name || '').trim().toLowerCase()
}

// filter: 'all' | 'named' | 'unnamed'. A non-empty query matches names only.
function filterSpeakers(rows, query, filter) {
  const q = _nameKey(query)
  return rows.filter(r => {
    if (filter === 'named' && !r.name) return false
    if (filter === 'unnamed' && r.name) return false
    return !q || _nameKey(r.name).includes(q)
  })
}

// Ids of named speakers whose name another speaker also has. Allowed — the id is
// the identity — but shown so the user can tell them apart.
function duplicateNameIds(rows) {
  const byKey = {}
  rows.filter(r => r.name).forEach(r => { (byKey[_nameKey(r.name)] ||= []).push(r.id) })
  return new Set(Object.values(byKey).filter(group => group.length > 1).flat())
}

function speakerDisplayName(row) {
  return row.name || 'Unnamed speaker'
}

function _plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function speakerStatsLine({ transcripts = 0, duration_sec = 0 }) {
  if (!transcripts) return 'Not in any transcript'
  return `${_plural(transcripts, 'transcript')} · ${fmtTime(duration_sec)}`
}

function deleteSpeakerPrompt({ name, segments = 0, transcripts = 0 }) {
  const effect = segments
    ? `${_plural(segments, 'segment')} in ${_plural(transcripts, 'transcript')} will become Unassigned. `
    : ''
  return {
    title: name ? `Delete “${name}”?` : 'Delete this speaker?',
    body: `${effect}The voice profile is removed, so this speaker will no longer be `
      + 'recognized in new recordings. This cannot be undone.',
  }
}

// ── New speaker ─────────────────────────────────────────────────────────────────
// Default color for a new speaker: the palette color fewest speakers use (lowest index on ties).
function leastUsedColorIndex(rows) {
  const counts = SPEAKER_PALETTE.map(() => 0)
  rows.forEach(r => { if (r.color_index in counts) counts[r.color_index]++ })
  return counts.indexOf(Math.min(...counts))
}

function hasSpeakerNamed(rows, name) {
  const key = _nameKey(name)
  return !!key && rows.some(r => r.name && _nameKey(r.name) === key)
}

// target: { id } for an existing speaker or { name, colorIndex? } for a new one.
// With a segmentStart only that segment is assigned, otherwise every segment of fromSpeakerId.
function speakerAssignRequest({ transcriptId, fromSpeakerId, segmentStart, target }) {
  const color = target.colorIndex != null ? { color_index: target.colorIndex } : {}
  if (segmentStart != null) {
    return {
      url: `${API_BASE}/transcripts/${transcriptId}/segments/${segmentStart}/speaker`,
      method: 'PATCH',
      body: target.id ? { speaker_id: target.id } : { speaker_name: target.name, ...color },
    }
  }
  return {
    url: `${API_BASE}/transcripts/${transcriptId}/reassign`,
    method: 'POST',
    body: target.id
      ? { from_speaker_id: fromSpeakerId, to_speaker_id: target.id }
      : { from_speaker_id: fromSpeakerId, to_speaker_name: target.name, ...color },
  }
}

// ── Editor ──────────────────────────────────────────────────────────────────────
// Remembers the scroll position of the elements matching selectors inside container;
// the returned function applies it to whatever matches after the view was rebuilt.
function preserveScroll(container, selectors) {
  const saved = selectors
    .map(sel => [sel, container.querySelector(sel)])
    .filter(([, el]) => el)
    .map(([sel, el]) => [sel, el.scrollTop])
  return () => saved.forEach(([sel, top]) => {
    const el = container.querySelector(sel)
    if (el) el.scrollTop = top
  })
}

// What the player bar shows for the audio element. The element outlives the rebuilt
// bar, and its events (durationchange, play) do not fire again for the new one.
function playerClock(audio) {
  return {
    elapsed: fmtTime(audio.currentTime || 0),
    total: isFinite(audio.duration) ? fmtTime(audio.duration) : '00:00',
    playing: !audio.paused,
  }
}

// Index of the segment playing at time t (start ≤ t < end) in segments sorted by
// start, or -1. Binary search: runs on every timeupdate.
function activeSegmentIndex(segments, t) {
  let lo = 0, hi = segments.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const s = segments[mid]
    if (s.end <= t)       lo = mid + 1
    else if (s.start > t) hi = mid - 1
    else                  return mid
  }
  return -1
}
