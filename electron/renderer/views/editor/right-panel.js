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

  const knownMap = {}
  knownSpeakers.forEach(s => { knownMap[s.id] = s.name })

  // Stable "Unknown N" display name for unrecognized speakers
  const { unrecIds } = buildSpeakerIndex(transcript.segments, knownMap)
  function getDisplayName(spkId) {
    if (knownMap[spkId]) return knownMap[spkId]
    const n = unrecIds.indexOf(spkId) + 1
    return n > 0 ? `Unknown ${n}` : spkId
  }

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

  // ── Tab bar (segmented control) ─────────────────────────────────────────────
  const tabBar = document.createElement('div')
  tabBar.className = 'right-tabs'

  const seg = document.createElement('div')
  seg.className = 'right-tabs-seg'
  tabBar.appendChild(seg)

  const TABS = ['Speakers', 'Chapters', 'Notes', 'Activity']
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
    btn.addEventListener('click', () => {
      if (label !== 'Speakers') {
        window.showToast?.(`${label} is not available yet`)
        return
      }
      setTab(label)
    })
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
    const unrecognized = Object.keys(durBySpeaker).filter(id => isUnrecognized(id, knownMap))

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
          spkId, knownMap[spkId] || spkId,
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
          spkId, `Unknown speaker ${i + 1}`,
          countBySpeaker[spkId], durBySpeaker[spkId],
          totalDur, transcriptId, onReload, knownSpeakers,
          sampleBySpeaker[spkId] || null, (setActive) => playPreview(firstSegBySpeaker[spkId], setActive), () => pausePreview(),
          suggestions[spkId] || null
        )
        content.appendChild(card)
      })
    }

    if (recognized.length === 0 && unrecognized.length === 0) {
      content.appendChild(emptyState('No speakers', 'Transcript has no segments.'))
    }
  }

  panel.appendChild(tabBar)
  panel.appendChild(content)
  renderContent()
  return panel
}
