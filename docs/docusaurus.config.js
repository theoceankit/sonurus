// @ts-check
// `@type` JSDoc annotations allow editor autocompletion and type checking
// (when paired with `@ts-check`).
// There are various equivalent ways to declare your Docusaurus config.
// See: https://docusaurus.io/docs/api/docusaurus-config

import {fileURLToPath} from 'node:url';
import prismTheme from './src/prism-theme.js';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Sonorus',
  tagline: 'Private meeting intelligence, on your device',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  markdown: {
    mermaid: true,
  },

  themes: ['@docusaurus/theme-mermaid'],

  plugins: [
    // Mermaid's parser pulls in vscode-languageserver-types, whose UMD build
    // (what the server bundle resolves) calls require dynamically and makes the
    // build warn. Its ESM build is the same code without that.
    () => ({
      name: 'resolve-languageserver-types-esm',
      configureWebpack: () => ({
        resolve: {
          alias: {
            // The package exports no subpaths, hence the file path.
            'vscode-languageserver-types$': fileURLToPath(
              new URL('./node_modules/vscode-languageserver-types/lib/esm/main.js', import.meta.url),
            ),
          },
        },
      }),
    }),
  ],

  // The site is not deployed yet. For GitHub Pages, set baseUrl to
  // '/sonurus/' (internal links are baseUrl-relative and keep working).
  url: 'https://theoceankit.github.io',
  baseUrl: '/',

  organizationName: 'theoceankit',
  projectName: 'sonurus',

  onBrokenLinks: 'throw',

  // ../ui/public carries the Inter licence, which the bundled font ships with.
  staticDirectories: ['static', '../ui/public'],

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',

      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          routeBasePath: '/',
        },
        blog: false,
        // Icons come straight from the app's set (src/theme/, AppIcon); SVGO
        // would rewrite their paths, so they are drawn as the files have them.
        svgr: {svgrConfig: {svgo: false}},
        theme: {
          // The app's own font and design tokens, then the docs styles on top.
          customCss: [
            '../ui/src/styles/fonts.css',
            '../ui/src/styles/tokens.css',
            './src/css/custom.css',
          ],
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/icon.png',
      colorMode: {
        defaultMode: 'dark',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'Sonorus',
        logo: {
          alt: 'Sonorus',
          src: 'img/logo.png',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'tutorialSidebar',
            position: 'left',
            label: 'Docs',
          },
          {
            type: 'html',
            position: 'right',
            value: '<a href="https://github.com/theoceankit/sonurus" target="_blank" rel="noopener noreferrer" class="navbar-github-btn"><svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15" aria-hidden="true"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.5v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z" /></svg>GitHub</a>',
          },
        ],
      },
      footer: {
        style: 'light',
        links: [
          {
            title: 'Product',
            items: [
              { label: 'Features', to: '/#capabilities' },
              { label: 'Privacy', to: '/#privacy' },
              { label: 'Download', to: '/#download' },
            ],
          },
          {
            title: 'Resources',
            items: [
              { label: 'Documentation', to: '/intro' },
              { label: 'Changelog', href: 'https://github.com/theoceankit/sonurus/releases' },
            ],
          },
          {
            title: 'Project',
            items: [
              { label: 'GitHub', href: 'https://github.com/theoceankit/sonurus' },
              { label: 'Known Issues', to: '/known-issues' },
              { label: 'Product Vision', to: '/roadmap/vision' },
            ],
          },
        ],
        copyright: `© ${new Date().getFullYear()} Sonorus · Your audio never leaves your device.`,
      },
      prism: {
        theme: prismTheme,
        darkTheme: prismTheme,
        // Used in the docs but not in Prism's default set.
        additionalLanguages: ['bash', 'powershell', 'sql'],
      },
      mermaid: {
        theme: {light: 'neutral', dark: 'dark'},
        // Mermaid sizes boxes to the text, so it has to measure in the page's
        // font; setting the font in CSS afterwards would cut labels off.
        options: {
          fontFamily: "'Inter', system-ui, sans-serif",
          themeVariables: {fontFamily: "'Inter', system-ui, sans-serif"},
        },
      },
    }),
};

export default config;
