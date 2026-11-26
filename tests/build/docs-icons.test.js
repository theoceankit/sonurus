'use strict'

// The docs site draws the app's icons straight from ui/src/assets/icons/ and
// puts them in place of Docusaurus' own by swizzling theme components into
// website/src/theme/. Neither breaks loudly in CI, which builds no docs: a renamed
// icon fails only the docs build, and a theme component Docusaurus renames in an
// update silently brings its own icon back.

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('fs')
const path   = require('path')

const ROOT  = path.resolve(__dirname, '..', '..')
const SITE  = path.join(ROOT, 'website')
const THEME = path.join(SITE, 'src', 'theme')
const ICONS = path.join(ROOT, 'ui', 'src', 'assets', 'icons')
const CLASSIC = path.join(SITE, 'node_modules', '@docusaurus', 'theme-classic', 'lib', 'theme')

const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name)
  return entry.isDirectory() ? files(full) : [full]
})

const sources = [
  ...files(THEME),
  ...files(path.join(SITE, 'src', 'pages')),
  path.join(SITE, 'src', 'css', 'custom.css'),
].filter(file => /\.(js|css)$/.test(file))

// Icon file names used by the docs, from imports (…/icons/x.svg) and CSS url()s alike.
const usedIcons = () => sources.flatMap(file =>
  [...fs.readFileSync(file, 'utf8').matchAll(/ui\/src\/assets\/icons\/([\w-]+)\.svg/g)]
    .map(match => ({ file: path.relative(ROOT, file), name: match[1] })))

test('every icon the docs site uses is a file of the app set', () => {
  const used = usedIcons()
  assert.ok(used.length > 0, 'the docs use no app icons at all')
  const missing = used.filter(({ name }) => !fs.existsSync(path.join(ICONS, `${name}.svg`)))
  assert.deepEqual(missing, [])
})

test('every swizzled file replaces a component of the Docusaurus theme', { skip: !fs.existsSync(CLASSIC) && 'website/node_modules is not installed' }, () => {
  const orphans = files(THEME)
    .map(file => path.relative(THEME, file).replace(/\.js$/, ''))
    .filter(component => !fs.existsSync(path.join(CLASSIC, `${component}.js`)))
  assert.deepEqual(orphans, [])
})
