# Sonorus documentation site

Built with [Docusaurus](https://docusaurus.io/). Docs are served from the site root (`routeBasePath: '/'`), so `docs/intro.md` is at `/intro`.

## Installation

```bash
npm ci
```

## Local development

```bash
npm start
```

Starts a dev server on port 3000 with live reload (listens on all interfaces, `--host 0.0.0.0`).

## Build

```bash
npm run build
npm run serve
```

Generates static content into `build/`. The build fails on broken links (`onBrokenLinks: 'throw'`).
