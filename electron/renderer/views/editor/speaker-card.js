// ── Speaker card (right panel) ─────────────────────────────────────────────────
function makeSpeakerCard(spkId, displayName, segCount, totalSec, transcriptDurSec, transcriptId, onReload, knownSpeakers = [], sample = null, onPreviewPlay = null, onPreviewPause = null, suggestion = null) {
  const SVG_PLAY_SM  = `<svg width="8" height="10" viewBox="0 0 11 12" fill="none"><path d="M1 1l9 5-9 5V1z" fill="currentColor"/></svg>`
  const SVG_PAUSE_SM = `<svg width="8" height="10" viewBox="0 0 11 12" fill="none"><rect x="1" y="1" width="3" height="10" rx="0.7" fill="currentColor"/><rect x="7" y="1" width="3" height="10" rx="0.7" fill="currentColor"/></svg>`
  const SVG_PLAY_MD  = `<svg width="9" height="11" viewBox="0 0 11 12" fill="none"><path d="M1 1l9 5-9 5V1z" fill="currentColor"/></svg>`
  const SVG_PAUSE_MD = `<svg width="9" height="11" viewBox="0 0 11 12" fill="none"><rect x="1" y="1" width="3" height="10" rx="0.7" fill="currentColor"/><rect x="7" y="1" width="3" height="10" rx="0.7" fill="currentColor"/></svg>`

  function makeToggle(btn, playSvg, pauseSvg) {
    let active = false
    function setActive(val) { active = val; btn.innerHTML = val ? pauseSvg : playSvg }
    btn.addEventListener('click', () => {
      if (active) { onPreviewPause?.(); setActive(false) }
      else { onPreviewPlay?.(setActive) }
    })
  }
  const _knownMap = {}
  knownSpeakers.forEach(s => { _knownMap[s.id] = { name: s.name, colorIndex: s.color_index ?? 0 } })
  const unrecognized = isUnrecognized(spkId, _knownMap)
  const p = unrecognized ? null : speakerPalette(spkId, _knownMap)

  const card = document.createElement('div')
  card.className = unrecognized ? 'spk-card spk-card--unknown' : 'spk-card'

  if (unrecognized) {
    // ── Unrecognized layout ─────────────────────────────────────────────────
    const top = document.createElement('div')
    top.className = 'spk-card-top'

    const avatar = makeAvatar(spkId, displayName, 28)

    const info = document.createElement('div')
    info.className = 'spk-card-info'

    const nameEl = document.createElement('div')
    nameEl.className = 'spk-card-name'
    nameEl.textContent = displayName

    const metaEl = document.createElement('div')
    metaEl.className = 'spk-card-meta'
    metaEl.textContent = `${segCount} segments  ${fmtTime(totalSec)}`

    info.appendChild(nameEl)
    info.appendChild(metaEl)

    const playBtn = document.createElement('button')
    playBtn.className = 'spk-card-play-btn'
    playBtn.innerHTML = SVG_PLAY_SM
    makeToggle(playBtn, SVG_PLAY_SM, SVG_PAUSE_SM)

    top.appendChild(avatar)
    top.appendChild(info)
    top.appendChild(playBtn)
    card.appendChild(top)

    // Quote
    if (sample) {
      const quote = document.createElement('div')
      quote.className = 'spk-quote'
      const quoteIcon = document.createElement('span')
      quoteIcon.className = 'spk-quote-icon'
      quoteIcon.setAttribute('aria-hidden', 'true')
      quoteIcon.textContent = '"'
      const quoteText = document.createElement('span')
      quoteText.className = 'spk-quote-text'
      quoteText.textContent = `${sample.slice(0, 80)}${sample.length > 80 ? '…' : ''}`
      quote.appendChild(quoteIcon)
      quote.appendChild(quoteText)
      card.appendChild(quote)
    }

    if (suggestion) {
      const p = speakerPalette(suggestion.speaker_id, _knownMap)
      const pct = Math.round(suggestion.score * 100)

      const sugg = document.createElement('div')
      sugg.className = 'spk-suggestion'
      sugg.style.background = p.bg
      sugg.style.border = `0.5px solid ${p.color}40`

      const dot = document.createElement('span')
      dot.className = 'spk-suggestion-dot'
      dot.style.background = p.color

      const txt = document.createElement('span')
      txt.className = 'spk-suggestion-text'
      txt.appendChild(document.createTextNode('Likely '))
      const nameSpan = document.createElement('span')
      nameSpan.className = 'spk-suggestion-name'
      nameSpan.style.color = p.color
      nameSpan.textContent = suggestion.name
      txt.appendChild(nameSpan)
      const pctSpan = document.createElement('span')
      pctSpan.className = 'spk-suggestion-pct'
      pctSpan.textContent = `${pct}%`
      txt.appendChild(pctSpan)

      const btns = document.createElement('div')
      btns.className = 'spk-suggestion-btns'

      const confirmBtn = document.createElement('button')
      confirmBtn.className = 'spk-suggestion-btn spk-suggestion-btn--confirm'
      confirmBtn.style.background = p.color
      confirmBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`
      confirmBtn.addEventListener('click', e => {
        e.stopPropagation()
        confirmBtn.disabled = true
        fetch(`${API_BASE}/transcripts/${transcriptId}/reassign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from_speaker_id: spkId, to_speaker_id: suggestion.speaker_id }),
        })
          .then(r => { if (!r.ok) throw new Error(r.status); onReload() })
          .catch(err => { confirmBtn.disabled = false; window.showToast?.(`Failed to confirm suggestion: ${err.message}`, 'error') })
      })

      const rejectBtn = document.createElement('button')
      rejectBtn.className = 'spk-suggestion-btn spk-suggestion-btn--reject'
      rejectBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 12 12" fill="none">
        <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>`
      rejectBtn.addEventListener('click', e => { e.stopPropagation(); sugg.remove() })

      btns.appendChild(confirmBtn)
      btns.appendChild(rejectBtn)
      sugg.appendChild(dot)
      sugg.appendChild(txt)
      sugg.appendChild(btns)
      card.appendChild(sugg)
    }

    // Assign speaker button
    const assignBtn = document.createElement('button')
    assignBtn.className = 'spk-assign-btn'
    assignBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <line x1="19" y1="8" x2="19" y2="14"/>
      <line x1="22" y1="11" x2="16" y2="11"/>
    </svg>Assign speaker`
    assignBtn.addEventListener('click', e => {
      e.stopPropagation()
      showSpeakerPicker(assignBtn, spkId, knownSpeakers, transcriptId, onReload)
    })
    card.appendChild(assignBtn)

    return card
  }

  // ── Recognized layout ───────────────────────────────────────────────────
  const top = document.createElement('div')
  top.className = 'spk-card-top'

  const avatar = makeAvatar(spkId, displayName, 28, _knownMap)
  const info = document.createElement('div')
  info.className = 'spk-card-info'

  const nameEl = document.createElement('div')
  nameEl.className = 'spk-card-name'
  nameEl.textContent = displayName

  const metaEl = document.createElement('div')
  metaEl.className = 'spk-card-meta'
  metaEl.textContent = `${segCount} segments  ${fmtTime(totalSec)}`

  info.appendChild(nameEl)
  info.appendChild(metaEl)

  const cardActions = document.createElement('div')
  cardActions.className = 'spk-card-actions'

  const playCardBtn = document.createElement('button')
  playCardBtn.className = 'spk-card-btn'
  playCardBtn.setAttribute('data-tooltip', 'Play speaker')
  playCardBtn.innerHTML = SVG_PLAY_MD
  attachSegTooltip(playCardBtn)
  makeToggle(playCardBtn, SVG_PLAY_MD, SVG_PAUSE_MD)

  const reassignCardBtn = document.createElement('button')
  reassignCardBtn.className = 'spk-card-btn'
  reassignCardBtn.setAttribute('data-tooltip', 'Assign speaker')
  reassignCardBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 11V8a2 2 0 0 0-2-2h-6m0 0l3 3m-3-3l3-3M3 13.013v3a2 2 0 0 0 2 2h6m0 0l-3-3m3 3l-3 3m8-4.511a2 2 0 1 0 4.001-.001a2 2 0 0 0-4.001.001m-12-12a2 2 0 1 0 4.001-.001A2 2 0 0 0 4 4.502m17 16.997a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2m-6-12a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2"/>
  </svg>`
  attachSegTooltip(reassignCardBtn)
  reassignCardBtn.addEventListener('click', e => {
    e.stopPropagation()
    showSpeakerPicker(reassignCardBtn, spkId, knownSpeakers, transcriptId, onReload)
  })

  cardActions.appendChild(playCardBtn)
  cardActions.appendChild(reassignCardBtn)

  top.appendChild(avatar)
  top.appendChild(info)
  top.appendChild(cardActions)
  card.appendChild(top)

  if (transcriptDurSec > 0) {
    const pct = Math.round(totalSec / transcriptDurSec * 100)
    const barWrap = document.createElement('div')
    barWrap.className = 'spk-dur-wrap'
    const track = document.createElement('div')
    track.className = 'spk-dur-track'
    const fill = document.createElement('div')
    fill.className = 'spk-dur-fill'
    fill.style.width = pct + '%'
    fill.style.background = p ? p.color : '#B58A3A'
    track.appendChild(fill)
    const pctLbl = document.createElement('span')
    pctLbl.className = 'spk-dur-pct'
    pctLbl.textContent = pct + '%'
    barWrap.appendChild(track)
    barWrap.appendChild(pctLbl)
    card.appendChild(barWrap)
  }

  return card
}
