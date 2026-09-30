// ── Speaker card (right panel) ─────────────────────────────────────────────────
function makeSpeakerCard(spkId, displayName, segCount, totalSec, transcriptDurSec, transcriptId, onReload, knownSpeakers = [], sample = null, onPreviewPlay = null, onPreviewPause = null, suggestion = null) {
  const ICON_PLAY_SM  = icon('play', 13)
  const ICON_PAUSE_SM = icon('pause', 13)
  const ICON_PLAY_MD  = icon('play', 15)
  const ICON_PAUSE_MD = icon('pause', 15)

  function makeToggle(btn, playSvg, pauseSvg) {
    let active = false
    function setActive(val) { active = val; btn.innerHTML = val ? pauseSvg : playSvg }
    btn.addEventListener('click', () => {
      if (active) { onPreviewPause?.(); setActive(false) }
      else { onPreviewPlay?.(setActive) }
    })
  }
  const _knownMap = buildKnownMap(knownSpeakers)
  const unrecognized = isUnrecognized(spkId, _knownMap)
  const p = unrecognized ? null : speakerPalette(spkId, _knownMap)

  const card = document.createElement('div')
  card.className = unrecognized ? 'spk-card spk-card--unknown' : 'spk-card'

  if (unrecognized) {
    // ── Unrecognized layout ─────────────────────────────────────────────────
    const top = document.createElement('div')
    top.className = 'spk-card-top'

    const avatar = makeAvatar(spkId, displayName, 'md', _knownMap)

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
    playBtn.innerHTML = ICON_PLAY_SM
    makeToggle(playBtn, ICON_PLAY_SM, ICON_PAUSE_SM)

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
      confirmBtn.innerHTML = icon('check', 11)
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
      rejectBtn.innerHTML = icon('close', 10)
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
    assignBtn.innerHTML = `${icon('assign-speaker', 12)}Assign speaker`
    assignBtn.addEventListener('click', e => {
      e.stopPropagation()
      showSpeakerPicker(assignBtn, spkId, knownSpeakers, transcriptId, onReload, { currentName: displayName })
    })
    card.appendChild(assignBtn)

    return card
  }

  // ── Recognized layout ───────────────────────────────────────────────────
  const top = document.createElement('div')
  top.className = 'spk-card-top'

  const avatar = makeAvatar(spkId, displayName, 'md', _knownMap)
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
  playCardBtn.innerHTML = ICON_PLAY_MD
  attachSegTooltip(playCardBtn)
  makeToggle(playCardBtn, ICON_PLAY_MD, ICON_PAUSE_MD)

  const reassignCardBtn = document.createElement('button')
  reassignCardBtn.className = 'spk-card-btn'
  reassignCardBtn.setAttribute('data-tooltip', 'Assign speaker')
  reassignCardBtn.innerHTML = icon('reassign-speaker', 14)
  attachSegTooltip(reassignCardBtn)
  reassignCardBtn.addEventListener('click', e => {
    e.stopPropagation()
    showSpeakerPicker(reassignCardBtn, spkId, knownSpeakers, transcriptId, onReload, { currentName: displayName })
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
