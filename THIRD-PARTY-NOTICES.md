# Third-Party Notices

**BP MD RTL Reader** is released under the [MIT License](LICENSE) © 2026 Binary Parse.
It makes use of the following third-party components. All are distributed under
permissive licenses compatible with MIT.

## Bundled with the application

The app makes **no network requests** at runtime (strict Content-Security-Policy); every
asset below is **vendored** under `assets/vendor/` and shipped inside the build. The
application declares **no production npm dependencies**.

### Runtime (the Electron shell)

| Component | License | Notes |
| --------- | ------- | ----- |
| [Electron](https://www.electronjs.org/) | MIT | The desktop runtime. Its copy of the license ships as `LICENSE.electron.txt`. |
| [Chromium](https://www.chromium.org/) (via Electron) | BSD-3-Clause and others | Full notices ship as `LICENSES.chromium.html` alongside the installed app. |
| [Node.js](https://nodejs.org/) (via Electron) | MIT | Bundled inside the Electron runtime. |

### Vendored libraries (`assets/vendor/`)

| Component | License | Used for |
| --------- | ------- | -------- |
| [CodeMirror 6](https://codemirror.net/) | MIT | The live-preview editor (bundled IIFE via esbuild) |
| [marked](https://marked.js.org/) | MIT | Markdown parsing |
| [DOMPurify](https://github.com/cure53/DOMPurify) | Apache-2.0 OR MPL-2.0 | HTML sanitisation |
| [KaTeX](https://katex.org/) | MIT | Math rendering |
| [highlight.js](https://highlightjs.org/) | BSD-3-Clause | Code syntax highlighting |
| [Mermaid](https://mermaid.js.org/) | MIT | Diagrams |
| [Lucide](https://lucide.dev/) | ISC | Toolbar / menu / palette icons (inlined as SVG `<symbol>`s, sourced from `lucide-static`) |

### Vendored fonts (`assets/vendor/fonts/`)

| Component | License |
| --------- | ------- |
| [Inter](https://rsms.me/inter/) | SIL Open Font License 1.1 |
| [Fraunces](https://fonts.google.com/specimen/Fraunces) | SIL Open Font License 1.1 |
| [JetBrains Mono](https://www.jetbrains.com/lp/mono/) | SIL Open Font License 1.1 |
| [IBM Plex Sans Arabic](https://www.ibm.com/plex/) | SIL Open Font License 1.1 |

See [`assets/vendor/fonts/LICENSES.md`](assets/vendor/fonts/LICENSES.md) for the full font notices.

## Development & build tools (not distributed)

The project is built and tested with permissively licensed tooling — Electron Builder
(MIT), Inno Setup, Vitest (MIT), Playwright (Apache-2.0), Stryker (Apache-2.0), ESLint
(MIT), and others. A scan of all 558 installed packages found only permissive licenses
(MIT, Apache-2.0, ISC, BSD, BlueOak, 0BSD, WTFPL, CC0) plus a small number of MPL-2.0
dev-only packages (`axe-core`, `@axe-core/playwright`, `eslint-plugin-no-unsanitized`,
`lightningcss`) — **no GPL/AGPL/LGPL**, and none of these ship in the application.

To regenerate a full dependency-license report:

```bash
npx license-checker --summary          # license totals
npx license-checker --excludePackages "$(node -p "require('./package.json').name")"
```
