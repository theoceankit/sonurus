// Code highlighting in the app's colours. The values are CSS variables from
// ui/src/styles/tokens.css, so one theme serves light and dark: the variables
// change with data-theme. Background and base text come from custom.css.

/** @type {import('prism-react-renderer').PrismTheme} */
const theme = {
  plain: {
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--color-bg-sunken)',
  },
  styles: [
    {
      types: ['comment', 'prolog', 'doctype', 'cdata'],
      style: {color: 'var(--color-text-secondary)', fontStyle: 'italic'},
    },
    {
      types: ['punctuation', 'operator'],
      style: {color: 'var(--color-text-secondary)'},
    },
    {
      types: ['keyword', 'selector', 'important', 'atrule', 'builtin'],
      style: {color: 'var(--color-accent-fg)'},
    },
    {
      types: ['string', 'char', 'attr-value', 'regex', 'inserted'],
      style: {color: 'var(--color-success-fg)'},
    },
    {
      types: ['number', 'boolean', 'constant', 'symbol'],
      style: {color: 'var(--color-speaker-4-fg)'},
    },
    {
      types: ['function', 'class-name'],
      style: {color: 'var(--color-speaker-1-fg)'},
    },
    {
      types: ['tag', 'attr-name', 'property'],
      style: {color: 'var(--color-speaker-5-fg)'},
    },
    {
      types: ['variable', 'parameter'],
      style: {color: 'var(--color-speaker-2-fg)'},
    },
    {
      types: ['deleted'],
      style: {color: 'var(--color-danger-fg)'},
    },
  ],
};

export default theme;
