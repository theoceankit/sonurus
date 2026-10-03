// ── Queued job settings modal ─────────────────────────────────────────────────
// Opened from the edit button of a queue card (not for the running job).
// Title, Whisper model and language of the job; only changed fields are sent.
// onSubmit(patch) must return a promise; a rejection keeps the modal open and
// shows the error (e.g. the model is not installed).
function openJobEditModal({ job, onSubmit }) {
  const overlay = document.createElement('div')
  overlay.className = 'nr-overlay'

  const modal = document.createElement('div')
  modal.className = 'nr-modal qj-modal'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-label', 'Transcription settings')

  const header = document.createElement('div')
  header.className = 'nr-modal-header'
  const title = document.createElement('div')
  title.className = 'nr-modal-title qj-title'
  title.textContent = 'Transcription settings'
  const closeBtn = document.createElement('button')
  closeBtn.className = 'nr-modal-close'
  closeBtn.setAttribute('aria-label', 'Close')
  closeBtn.innerHTML = icon('close', 8)
  header.append(title, closeBtn)

  const body = document.createElement('div')
  body.className = 'nr-modal-body'

  function field(labelText, control, forId) {
    const el = document.createElement('div')
    el.className = 'nr-field'
    const lbl = document.createElement('label')
    lbl.className = 'nr-field-label'
    lbl.textContent = labelText
    if (forId) lbl.htmlFor = forId
    el.append(lbl, control)
    return el
  }

  // Title
  const input = document.createElement('input')
  input.id = 'qj-title'
  input.className = 'st-text-input'
  input.maxLength = TITLE_MAX_LENGTH
  input.value = job.title

  // Model: models not downloaded are disabled ("Not installed"); the job's
  // own model stays visible even if it was deleted, until another is picked.
  let model = job.whisper_model
  const modelWrap = document.createElement('div')
  modelWrap.className = 'nr-field-dropdown-wrap'
  function buildModelDropdown(state) {
    const opts = state
      ? state.models.filter(m => m.kind === 'whisper')
        .map(m => ({ value: m.id, label: m.name, disabled: !m.installed }))
      : []
    if (!opts.some(o => o.value === model)) opts.push({ value: model, label: model, disabled: !!state })
    modelWrap.replaceChildren(makeDropdown(opts, model, v => { model = v; clearError() }, renderModelOption))
  }
  buildModelDropdown(modelState())
  syncTranscribeModel().then(state => { if (state) buildModelDropdown(state) })

  // Language: 'auto' = detect
  let language = job.language || 'auto'
  const langOpts = LANGUAGES.map(l => ({ value: l.code, label: l.label }))
  if (!langOpts.some(o => o.value === language)) langOpts.push({ value: language, label: language })
  const langWrap = document.createElement('div')
  langWrap.className = 'nr-field-dropdown-wrap'
  langWrap.appendChild(makeDropdown(langOpts, language, v => { language = v; clearError() }))

  const row = document.createElement('div')
  row.className = 'nr-fields-row'
  row.append(field('Model', modelWrap), field('Language', langWrap))

  const error = document.createElement('div')
  error.className = 'spk-name-error'

  body.append(field('Title', input, 'qj-title'), row, error)

  const footer = document.createElement('div')
  footer.className = 'confirm-btns qj-footer'
  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'st-btn st-btn--ghost'
  cancelBtn.textContent = 'Cancel'
  const saveBtn = document.createElement('button')
  saveBtn.className = 'st-btn st-btn--primary'
  saveBtn.textContent = 'Save'
  footer.append(cancelBtn, saveBtn)

  modal.append(header, body, footer)
  overlay.appendChild(modal)

  let busy = false
  function clearError() { error.textContent = '' }

  async function submit() {
    if (busy) return
    const { patch, error: invalid } = jobEditPatch(job, { title: input.value, model, language })
    if (invalid) { error.textContent = invalid; return }
    if (!patch) { close(); return }
    busy = saveBtn.disabled = true
    try {
      await onSubmit(patch)
      close()
    } catch (err) {
      busy = saveBtn.disabled = false
      error.textContent = err.message
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close() }
  }
  function close() {
    document.removeEventListener('keydown', onKey)
    overlay.remove()
  }
  document.addEventListener('keydown', onKey)
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close() })
  closeBtn.addEventListener('click', close)
  cancelBtn.addEventListener('click', close)
  saveBtn.addEventListener('click', submit)
  input.addEventListener('input', clearError)
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit() } })

  document.body.appendChild(overlay)
  input.focus()
  input.select()
  return overlay
}
