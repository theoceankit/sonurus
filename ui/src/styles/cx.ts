// Joins class names, skipping the ones that do not apply.
export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ')
