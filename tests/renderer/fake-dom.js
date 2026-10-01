// Permissive stand-in for a DOM element, for renderer code that builds UI:
// known members are real, any other method is a no-op. Listeners are kept so
// tests can fire them. Every element is pushed to `created`.
function fakeElement(created = []) {
  const attrs = new Set()
  const listeners = {}
  const target = {
    className: '',
    style: {},
    dataset: {},
    value: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute: name => attrs.add(name),
    hasAttribute: name => attrs.has(name),
    removeAttribute: name => attrs.delete(name),
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn) },
    querySelectorAll: () => [],
    fire: (type, event = {}) => (listeners[type] || []).forEach(fn => fn(event)),
  }
  const el = new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key]
      // Never look like a promise, or awaiting an element would hang.
      if (typeof key !== 'string' || key === 'then') return undefined
      return () => {}
    },
  })
  created.push(el)
  return el
}

module.exports = { fakeElement }
