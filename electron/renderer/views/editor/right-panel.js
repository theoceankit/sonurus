// ── Right panel ────────────────────────────────────────────────────────────────
let _rightPanelPreviewAudio = null  // track to stop/clean up on rebuild

function makeRightPanel(transcript, knownSpeakers, transcriptId, onReload, audio = null, suggestions = {}, signal = null) {
  // Stop any preview playing from a previous right-panel build
  if (_rightPanelPreviewAudio) {
    _rightPanelPreviewAudio.pause()
    _rightPanelPreviewAudio.src = ''
    _rightPanelPreviewAudio = null
  }

  const panel = document.createElement('div')
  panel.className = 'right-panel'

  const knownMap = buildKnownMap(knownSpeakers)

  // ── Speaker preview (separate Audio element, player bar unaffected) ──────────
  const previewAudio = new Audio()
  _rightPanelPreviewAudio = previewAudio
  let previewStopFn = null
  let currentSetActive = null

  function stopPreview() {
    if (previewStopFn) {
      previewAudio.removeEventListener('timeupdate', previewStopFn)
      previewStopFn = null
    }
    previewAudio.pause()
    if (currentSetActive) { currentSetActive(false); currentSetActive = null }
  }

  function playPreview(seg, setActive) {
    if (!audio || !seg) return
    stopPreview()
    if (!audio.paused) audio.pause()
    currentSetActive = setActive
    setActive(true)
    if (previewAudio.src !== audio.src) previewAudio.src = audio.src
    previewAudio.currentTime = seg.start
    previewAudio.play()
    previewStopFn = () => {
      if (previewAudio.currentTime >= seg.end) {
        previewAudio.removeEventListener('timeupdate', previewStopFn)
        previewStopFn = null
        previewAudio.pause()
        if (currentSetActive) { currentSetActive(false); currentSetActive = null }
      }
    }
    previewAudio.addEventListener('timeupdate', previewStopFn)
  }

  function pausePreview() {
    if (previewStopFn) {
      previewAudio.removeEventListener('timeupdate', previewStopFn)
      previewStopFn = null
    }
    previewAudio.pause()
  }

  // Stop preview when user resumes main player
  if (audio) audio.addEventListener('play', () => { if (panel.isConnected) stopPreview() }, { signal })
  // …and when the editor is rebuilt or left (the signal is aborted in both cases)
  signal?.addEventListener('abort', () => stopPreview())

  // ── Tab bar (segmented control) ─────────────────────────────────────────────
  const tabBar = document.createElement('div')
  tabBar.className = 'right-tabs'

  const seg = document.createElement('div')
  seg.className = 'right-tabs-seg'
  tabBar.appendChild(seg)

  const TABS = ['Speakers', 'Chapters', 'Notes', 'Activity']
  const UNIMPLEMENTED_TABS = {
    Chapters: 'editor.tab-chapters',
    Notes:    'editor.tab-notes',
    Activity: 'editor.tab-activity',
  }
  let activeTab = 'Speakers'

  const content = document.createElement('div')
  content.className = 'right-content quiet-scroll'

  function setTab(label) {
    activeTab = label
    seg.querySelectorAll('.right-tab-btn').forEach(b => {
      b.classList.toggle('right-tab-btn--active', b.textContent === label)
    })
    renderContent()
  }

  TABS.forEach(label => {
    const btn = document.createElement('button')
    btn.className = 'right-tab-btn' + (label === activeTab ? ' right-tab-btn--active' : '')
    btn.textContent = label
    btn.addEventListener('click', () => setTab(label))
    markNotImplemented(btn, UNIMPLEMENTED_TABS[label])
    seg.appendChild(btn)
  })

  // ── Render dispatcher ───────────────────────────────────────────────────────
  function renderContent() {
    content.innerHTML = ''
    renderSpeakers()
  }

  // ── Empty state helper ──────────────────────────────────────────────────────
  function emptyState(title, hint = '') {
    const el = document.createElement('div')
    el.className = 'right-empty'
    el.innerHTML = `<div class="right-empty-title">${title}</div>`
    if (hint) {
      const h = document.createElement('div')
      h.style.cssText = 'font-size:11.5px;color:var(--ink-dim);margin-top:4px;line-height:1.45'
      h.textContent = hint
      el.appendChild(h)
    }
    return el
  }

  // ── Speakers tab ────────────────────────────────────────────────────────────
  function renderSpeakers() {
    const durBySpeaker = {}, countBySpeaker = {}, sampleBySpeaker = {}, firstSegBySpeaker = {}
    let totalDur = 0
    transcript.segments.forEach(seg => {
      const spkId = effectiveSpeaker(seg)
      const d = seg.end - seg.start
      durBySpeaker[spkId] = (durBySpeaker[spkId] || 0) + d
      countBySpeaker[spkId] = (countBySpeaker[spkId] || 0) + 1
      totalDur += d
      if (!sampleBySpeaker[spkId]) {
        sampleBySpeaker[spkId] = seg.text
        firstSegBySpeaker[spkId] = { start: seg.start, end: seg.end }
      }
    })

    const recognized   = Object.keys(durBySpeaker).filter(id => !isUnrecognized(id, knownMap))
    const unrecognized = Object.keys(durBySpeaker).filter(id => id !== UNASSIGNED_ID && isUnrecognized(id, knownMap))
    const hasUnassigned = UNASSIGNED_ID in durBySpeaker

    function sectionLabel(text, count) {
      const lbl = document.createElement('div')
      lbl.className = 'right-section-label'
      lbl.innerHTML = `${text}<span class="right-section-count">${count}</span>`
      return lbl
    }

    if (recognized.length > 0) {
      content.appendChild(sectionLabel('Recognized', recognized.length))
      recognized.forEach(spkId => {
        content.appendChild(makeSpeakerCard(
          spkId, knownMap[spkId].name,
          countBySpeaker[spkId], durBySpeaker[spkId],
          totalDur, transcriptId, onReload, knownSpeakers,
          null, (setActive) => playPreview(firstSegBySpeaker[spkId], setActive), () => pausePreview()
        ))
      })
    }

    if (unrecognized.length > 0) {
      content.appendChild(sectionLabel('Unrecognized', unrecognized.length))
      unrecognized.forEach((spkId, i) => {
        const card = makeSpeakerCard(
          spkId, `Unknown ${i + 1}`,  // same numbering as segment rows (first appearance)
          countBySpeaker[spkId], durBySpeaker[spkId],
          totalDur, transcriptId, onReload, knownSpeakers,
          sampleBySpeaker[spkId] || null, (setActive) => playPreview(firstSegBySpeaker[spkId], setActive), () => pausePreview(),
          suggestions[spkId] || null
        )
        content.appendChild(card)
      })
    }

    // Segments of deleted speakers — one group, assignable in bulk
    if (hasUnassigned) {
      content.appendChild(sectionLabel('Unassigned', ''))
      content.appendChild(makeSpeakerCard(
        UNASSIGNED_ID, 'Unassigned',
        countBySpeaker[UNASSIGNED_ID], durBySpeaker[UNASSIGNED_ID],
        totalDur, transcriptId, onReload, knownSpeakers,
        sampleBySpeaker[UNASSIGNED_ID] || null,
        (setActive) => playPreview(firstSegBySpeaker[UNASSIGNED_ID], setActive), () => pausePreview()
      ))
    }

    if (recognized.length === 0 && unrecognized.length === 0 && !hasUnassigned) {
      content.appendChild(emptyState('No speakers', 'Transcript has no segments.'))
    }
  }

  panel.appendChild(tabBar)
  panel.appendChild(content)
  renderContent()
  return panel
}
