# Third-Party Notices

**BP MD RTL Reader** is released under the [MIT License](LICENSE) © 2026 Binary Parse.
It makes use of the following third-party components. All are distributed under
permissive licenses compatible with MIT.

## Bundled with the application

| Component | License | Notes |
| --------- | ------- | ----- |
| [Electron](https://www.electronjs.org/) | MIT | The desktop runtime. Its copy of the license ships as `LICENSE.electron.txt`. |
| [Chromium](https://www.chromium.org/) (via Electron) | BSD-3-Clause and others | Full notices ship as `LICENSES.chromium.html` alongside the installed app. |
| [Node.js](https://nodejs.org/) (via Electron) | MIT | Bundled inside the Electron runtime. |

> The application itself declares **no production npm dependencies**, so no other
> third-party packages are bundled into the app.

## Loaded at runtime from a CDN (not redistributed)

These are fetched on first run when online, with Subresource Integrity, and are not
shipped inside the installer:

| Component | License |
| --------- | ------- |
| [marked](https://marked.js.org/) | MIT |
| [DOMPurify](https://github.com/cure53/DOMPurify) | Apache-2.0 OR MPL-2.0 |
| [Inter](https://rsms.me/inter/) | SIL Open Font License 1.1 |
| [Fraunces](https://fonts.google.com/specimen/Fraunces) | SIL Open Font License 1.1 |
| [JetBrains Mono](https://www.jetbrains.com/lp/mono/) | SIL Open Font License 1.1 |
| [IBM Plex Sans Arabic](https://www.ibm.com/plex/) | SIL Open Font License 1.1 |

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
