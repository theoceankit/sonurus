// ── Toast system ───────────────────────────────────────────────────────────────
// Mounted once at startup; exposes window.showToast(text, opts).
// opts may be a string tone ('error') or an object { tone, actionLabel, action, duration }.

(function mountToast() {
  const stack = document.createElement('div')
  stack.id = 'toast-stack'
  document.body.appendChild(stack)

  window.showToast = function(text, opts = {}) {
    const tone = typeof opts === 'string' ? opts : opts.tone
    const { actionLabel, action, duration = 3200 } = typeof opts === 'string' ? {} : opts
    const toast = document.createElement('div')
    toast.className = 'toast' + (tone === 'error' ? ' toast--error' : '')

    const msg = document.createElement('span')
    msg.className = 'toast-text'
    msg.textContent = text
    toast.appendChild(msg)

    if (actionLabel) {
      const btn = document.createElement('button')
      btn.className = 'toast-action'
      btn.textContent = actionLabel
      btn.addEventListener('click', () => { action?.(); dismiss() })
      toast.appendChild(btn)
    }

    const closeBtn = document.createElement('button')
    closeBtn.className = 'toast-close'
    closeBtn.textContent = '✕'
    closeBtn.addEventListener('click', dismiss)
    toast.appendChild(closeBtn)

    stack.appendChild(toast)
    requestAnimationFrame(() => toast.classList.add('toast--visible'))

    let timer = setTimeout(dismiss, duration)

    function dismiss() {
      clearTimeout(timer)
      toast.classList.remove('toast--visible')
      toast.classList.add('toast--out')
      setTimeout(() => toast.remove(), 220)
    }

    return { dismiss }
  }
})()
