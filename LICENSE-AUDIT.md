# Dependency License Audit

_Generated: 2026-07-23_

**Scope:** all dependencies (direct + transitive) resolved from `package-lock.json` (lockfileVersion 3), **plus** the vendored fonts shipped in `assets/vendor/**` (binary assets that `license-checker` does not see — audited separately in [Vendored fonts](#vendored-fonts-shipped-assets--not-npm-packages)).

**Ecosystem:** Node.js / npm only. No Python, Rust, Go, Ruby, PHP, or Java manifests exist in this repo.

**Tooling:** `npx license-checker --json` run against the installed `node_modules` (766 third-party packages); vendored fonts reviewed by hand against the license notices shipped with them.

**Runtime vs dev:** the project declares **no** runtime `dependencies` — every direct dependency is a `devDependency`, so npm classifies all 766 packages as `dev`. A subset (marked `dev (vendored->shipped)`) is bundled by esbuild into `assets/vendor/**` and ships inside the packaged app, so their (all permissive) licenses still carry redistribution obligations.

> The root project package `bpmdrtlreader@1.0.0` is the audit **subject**, not a dependency, and is excluded from the table. Its manifest declares `"license": "MIT"` and `"private": true` (never published); license-checker's default heuristic labels the private root `UNLICENSED`, which does not reflect the declared license.

## Summary

| Bucket | Count |
|---|---:|
| OK | 760 |
| REVIEW | 6 |
| BLOCKED | 0 |
| UNKNOWN | 0 |
| **Total** | **766** |

Direct: **35** · Transitive: **731**.

### License distribution

| License (as reported by tooling) | Packages |
|---|---:|
| MIT | 569 |
| ISC | 84 |
| Apache-2.0 | 42 |
| BSD-3-Clause | 24 |
| BSD-2-Clause | 19 |
| BlueOak-1.0.0 | 9 |
| MPL-2.0 | 5 |
| MIT-0 | 2 |
| (WTFPL OR MIT) | 2 |
| Python-2.0 | 1 |
| CC-BY-4.0 | 1 |
| (MPL-2.0 OR Apache-2.0) | 1 |
| MIT* | 1 |
| CC0-1.0 | 1 |
| Unlicense | 1 |
| WTFPL OR ISC | 1 |
| WTFPL | 1 |
| 0BSD | 1 |
| (MIT OR CC0-1.0) | 1 |

Notes on license strings:
- `MIT*` (khroma@2.1.0): no `license` field in its manifest; the tool read the on-disk `license` file, which is verbatim *The MIT License (MIT)*. Verified -> MIT.
- Dual `(A OR B)` licenses are bucketed by the most permissive allowed option (e.g. `(MPL-2.0 OR Apache-2.0)` -> Apache-2.0 -> OK; `WTFPL OR ISC` -> ISC -> OK; `(WTFPL OR MIT)` -> MIT -> OK).
- `BlueOak-1.0.0`, `Python-2.0`, `MIT-0`, `WTFPL` are permissive / public-domain-equivalent OSI/FSF-recognized licenses **not literally enumerated** in the OK allowlist; treated as OK (all are open source).

## Full dependency table

| Package | Version | License | Direct/Transitive | Runtime/Dev | Bucket |
|---|---|---|---|---|---|
| @axe-core/playwright | 4.12.1 | MPL-2.0 | direct | dev | REVIEW |
| axe-core | 4.12.1 | MPL-2.0 | direct | dev | REVIEW |
| caniuse-lite | 1.0.30001793 | CC-BY-4.0 | transitive | dev | REVIEW |
| eslint-plugin-no-unsanitized | 4.1.5 | MPL-2.0 | direct | dev | REVIEW |
| lightningcss | 1.33.0 | MPL-2.0 | transitive | dev | REVIEW |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 | transitive | dev | REVIEW |
| @antfu/install-pkg | 1.1.0 | MIT | transitive | dev | OK |
| @asamuzakjp/css-color | 5.1.11 | MIT | transitive | dev | OK |
| @asamuzakjp/dom-selector | 7.1.1 | MIT | transitive | dev | OK |
| @asamuzakjp/generational-cache | 1.0.1 | MIT | transitive | dev | OK |
| @asamuzakjp/nwsapi | 2.3.9 | MIT | transitive | dev | OK |
| @babel/code-frame | 7.29.7 | MIT | transitive | dev | OK |
| @babel/compat-data | 7.29.7 | MIT | transitive | dev | OK |
| @babel/core | 7.29.7 | MIT | transitive | dev | OK |
| @babel/generator | 7.29.7 | MIT | transitive | dev | OK |
| @babel/helper-annotate-as-pure | 7.29.7 | MIT | transitive | dev | OK |
| @babel/helper-compilation-targets | 7.29.7 | MIT | transitive | dev | OK |
| @babel/helper-create-class-features-plugin | 7.29.7 | MIT | transitive | dev | OK |
| @babel/helper-globals | 7.29.7 | MIT | transitive | dev | OK |
| @babel/helper-member-expression-to-functions | 7.29.7 | MIT | transitive | dev | OK |
| @babel/helper-module-imports | 7.29.7 | MIT | transitive | dev | OK |
| @babel/helper-module-transforms | 7.29.7 | MIT | transitive | dev | OK |
| @babel/helper-optimise-call-expression | 7.29.7 | MIT | transitive | dev | OK |
| @babel/helper-plugin-utils | 7.29.7 | MIT | transitive | dev | OK |
| @babel/helper-replace-supers | 7.29.7 | MIT | transitive | dev | OK |
| @babel/helper-skip-transparent-expression-wrappers | 7.29.7 | MIT | transitive | dev | OK |
| @babel/helper-string-parser | 7.29.7 | MIT | transitive | dev | OK |
| @babel/helper-validator-identifier | 7.29.7 | MIT | transitive | dev | OK |
| @babel/helper-validator-option | 7.29.7 | MIT | transitive | dev | OK |
| @babel/helpers | 7.29.7 | MIT | transitive | dev | OK |
| @babel/parser | 7.29.7 | MIT | transitive | dev | OK |
| @babel/plugin-proposal-decorators | 7.29.7 | MIT | transitive | dev | OK |
| @babel/plugin-syntax-decorators | 7.29.7 | MIT | transitive | dev | OK |
| @babel/plugin-syntax-jsx | 7.29.7 | MIT | transitive | dev | OK |
| @babel/plugin-syntax-typescript | 7.29.7 | MIT | transitive | dev | OK |
| @babel/plugin-transform-destructuring | 7.29.7 | MIT | transitive | dev | OK |
| @babel/plugin-transform-explicit-resource-management | 7.29.7 | MIT | transitive | dev | OK |
| @babel/plugin-transform-modules-commonjs | 7.29.7 | MIT | transitive | dev | OK |
| @babel/plugin-transform-typescript | 7.29.7 | MIT | transitive | dev | OK |
| @babel/preset-typescript | 7.28.5 | MIT | transitive | dev | OK |
| @babel/template | 7.29.7 | MIT | transitive | dev | OK |
| @babel/traverse | 7.29.7 | MIT | transitive | dev | OK |
| @babel/types | 7.29.7 | MIT | transitive | dev | OK |
| @bcoe/v8-coverage | 1.0.2 | MIT | transitive | dev | OK |
| @braintree/sanitize-url | 7.1.2 | MIT | transitive | dev | OK |
| @bramus/specificity | 2.4.2 | MIT | transitive | dev | OK |
| @chevrotain/types | 11.1.2 | Apache-2.0 | transitive | dev | OK |
| @codemirror/autocomplete | 6.20.3 | MIT | transitive | dev | OK |
| @codemirror/commands | 6.10.4 | MIT | direct | dev (vendored->shipped) | OK |
| @codemirror/lang-css | 6.3.1 | MIT | transitive | dev | OK |
| @codemirror/lang-html | 6.4.11 | MIT | transitive | dev | OK |
| @codemirror/lang-javascript | 6.2.5 | MIT | transitive | dev | OK |
| @codemirror/lang-markdown | 6.5.1 | MIT | direct | dev (vendored->shipped) | OK |
| @codemirror/language | 6.12.4 | MIT | direct | dev (vendored->shipped) | OK |
| @codemirror/lint | 6.9.6 | MIT | transitive | dev | OK |
| @codemirror/search | 6.7.1 | MIT | direct | dev (vendored->shipped) | OK |
| @codemirror/state | 6.7.1 | MIT | direct | dev (vendored->shipped) | OK |
| @codemirror/view | 6.43.6 | MIT | direct | dev (vendored->shipped) | OK |
| @colors/colors | 1.5.0 | MIT | transitive | dev | OK |
| @csstools/color-helpers | 6.0.2 | MIT-0 | transitive | dev | OK |
| @csstools/css-calc | 3.2.1 | MIT | transitive | dev | OK |
| @csstools/css-color-parser | 4.1.1 | MIT | transitive | dev | OK |
| @csstools/css-parser-algorithms | 4.0.0 | MIT | transitive | dev | OK |
| @csstools/css-syntax-patches-for-csstree | 1.1.4 | MIT-0 | transitive | dev | OK |
| @csstools/css-tokenizer | 4.0.0 | MIT | transitive | dev | OK |
| @electron-internal/extract-zip | 1.0.4 | BSD-2-Clause | transitive | dev | OK |
| @electron/asar | 3.4.1 | MIT | direct | dev | OK |
| @electron/fuses | 1.8.0 | MIT | transitive | dev | OK |
| @electron/get | 3.1.0 | MIT | transitive | dev | OK |
| @electron/get | 5.0.0 | MIT | transitive | dev | OK |
| @electron/notarize | 2.5.0 | MIT | transitive | dev | OK |
| @electron/osx-sign | 1.3.3 | BSD-2-Clause | transitive | dev | OK |
| @electron/rebuild | 4.2.0 | MIT | transitive | dev | OK |
| @electron/universal | 2.0.3 | MIT | transitive | dev | OK |
| @electron/windows-sign | 1.2.2 | BSD-2-Clause | transitive | dev | OK |
| @esbuild/win32-x64 | 0.28.1 | MIT | transitive | dev | OK |
| @eslint-community/eslint-utils | 4.9.1 | MIT | transitive | dev | OK |
| @eslint-community/regexpp | 4.12.2 | MIT | transitive | dev | OK |
| @eslint/config-array | 0.23.5 | Apache-2.0 | transitive | dev | OK |
| @eslint/config-helpers | 0.6.0 | Apache-2.0 | transitive | dev | OK |
| @eslint/core | 1.2.1 | Apache-2.0 | transitive | dev | OK |
| @eslint/object-schema | 3.0.5 | Apache-2.0 | transitive | dev | OK |
| @eslint/plugin-kit | 0.7.2 | Apache-2.0 | transitive | dev | OK |
| @exodus/bytes | 1.15.1 | MIT | transitive | dev | OK |
| @humanfs/core | 0.19.2 | Apache-2.0 | transitive | dev | OK |
| @humanfs/node | 0.16.8 | Apache-2.0 | transitive | dev | OK |
| @humanfs/types | 0.15.0 | Apache-2.0 | transitive | dev | OK |
| @humanwhocodes/module-importer | 1.0.1 | Apache-2.0 | transitive | dev | OK |
| @humanwhocodes/retry | 0.4.3 | Apache-2.0 | transitive | dev | OK |
| @iconify/types | 2.0.0 | MIT | transitive | dev | OK |
| @iconify/utils | 3.1.4 | MIT | transitive | dev | OK |
| @inquirer/ansi | 2.0.6 | MIT | transitive | dev | OK |
| @inquirer/checkbox | 5.2.0 | MIT | transitive | dev | OK |
| @inquirer/confirm | 6.1.0 | MIT | transitive | dev | OK |
| @inquirer/core | 11.2.0 | MIT | transitive | dev | OK |
| @inquirer/editor | 5.2.0 | MIT | transitive | dev | OK |
| @inquirer/expand | 5.1.0 | MIT | transitive | dev | OK |
| @inquirer/external-editor | 3.0.1 | MIT | transitive | dev | OK |
| @inquirer/figures | 2.0.6 | MIT | transitive | dev | OK |
| @inquirer/input | 5.1.0 | MIT | transitive | dev | OK |
| @inquirer/number | 4.1.0 | MIT | transitive | dev | OK |
| @inquirer/password | 5.1.0 | MIT | transitive | dev | OK |
| @inquirer/prompts | 8.5.0 | MIT | transitive | dev | OK |
| @inquirer/rawlist | 5.3.0 | MIT | transitive | dev | OK |
| @inquirer/search | 4.2.0 | MIT | transitive | dev | OK |
| @inquirer/select | 5.2.0 | MIT | transitive | dev | OK |
| @inquirer/type | 4.0.6 | MIT | transitive | dev | OK |
| @isaacs/fs-minipass | 4.0.1 | ISC | transitive | dev | OK |
| @jridgewell/gen-mapping | 0.3.13 | MIT | transitive | dev | OK |
| @jridgewell/remapping | 2.3.5 | MIT | transitive | dev | OK |
| @jridgewell/resolve-uri | 3.1.2 | MIT | transitive | dev | OK |
| @jridgewell/sourcemap-codec | 1.5.5 | MIT | transitive | dev | OK |
| @jridgewell/trace-mapping | 0.3.31 | MIT | transitive | dev | OK |
| @jscpd/badge-reporter | 4.2.5 | MIT | transitive | dev | OK |
| @jscpd/core | 4.2.5 | MIT | transitive | dev | OK |
| @jscpd/finder | 4.2.5 | MIT | transitive | dev | OK |
| @jscpd/html-reporter | 4.2.5 | MIT | transitive | dev | OK |
| @jscpd/tokenizer | 4.2.5 | MIT | transitive | dev | OK |
| @lezer/common | 1.5.2 | MIT | transitive | dev | OK |
| @lezer/css | 1.3.3 | MIT | transitive | dev | OK |
| @lezer/highlight | 1.2.3 | MIT | direct | dev (vendored->shipped) | OK |
| @lezer/html | 1.3.13 | MIT | transitive | dev | OK |
| @lezer/javascript | 1.5.4 | MIT | transitive | dev | OK |
| @lezer/lr | 1.4.10 | MIT | transitive | dev | OK |
| @lezer/markdown | 1.6.4 | MIT | transitive | dev | OK |
| @malept/cross-spawn-promise | 2.0.0 | Apache-2.0 | transitive | dev | OK |
| @malept/flatpak-bundler | 0.4.0 | MIT | transitive | dev | OK |
| @marijn/find-cluster-break | 1.0.2 | MIT | transitive | dev | OK |
| @mermaid-js/parser | 1.2.0 | MIT | transitive | dev | OK |
| @noble/hashes | 1.4.0 | MIT | transitive | dev | OK |
| @noble/hashes | 2.2.0 | MIT | transitive | dev | OK |
| @nodelib/fs.scandir | 2.1.5 | MIT | transitive | dev | OK |
| @nodelib/fs.stat | 2.0.5 | MIT | transitive | dev | OK |
| @nodelib/fs.walk | 1.2.8 | MIT | transitive | dev | OK |
| @oxc-project/types | 0.139.0 | MIT | transitive | dev | OK |
| @peculiar/asn1-schema | 2.8.0 | MIT | transitive | dev | OK |
| @peculiar/json-schema | 1.1.12 | MIT | transitive | dev | OK |
| @peculiar/utils | 2.0.3 | MIT | transitive | dev | OK |
| @peculiar/webcrypto | 1.7.1 | MIT | transitive | dev | OK |
| @playwright/test | 1.61.1 | Apache-2.0 | direct | dev | OK |
| @rolldown/binding-win32-x64-msvc | 1.1.5 | MIT | transitive | dev | OK |
| @rolldown/pluginutils | 1.0.1 | MIT | transitive | dev | OK |
| @sec-ant/readable-stream | 0.4.1 | MIT | transitive | dev | OK |
| @sindresorhus/is | 4.6.0 | MIT | transitive | dev | OK |
| @sindresorhus/merge-streams | 4.0.0 | MIT | transitive | dev | OK |
| @standard-schema/spec | 1.1.0 | MIT | transitive | dev | OK |
| @stryker-mutator/api | 9.6.1 | Apache-2.0 | transitive | dev | OK |
| @stryker-mutator/core | 9.6.1 | Apache-2.0 | direct | dev | OK |
| @stryker-mutator/instrumenter | 9.6.1 | Apache-2.0 | transitive | dev | OK |
| @stryker-mutator/util | 9.6.1 | Apache-2.0 | transitive | dev | OK |
| @stryker-mutator/vitest-runner | 9.6.1 | Apache-2.0 | direct | dev | OK |
| @szmarczak/http-timer | 4.0.6 | MIT | transitive | dev | OK |
| @types/cacheable-request | 6.0.3 | MIT | transitive | dev | OK |
| @types/chai | 5.2.3 | MIT | transitive | dev | OK |
| @types/d3 | 7.4.3 | MIT | transitive | dev | OK |
| @types/d3-array | 3.2.2 | MIT | transitive | dev | OK |
| @types/d3-axis | 3.0.6 | MIT | transitive | dev | OK |
| @types/d3-brush | 3.0.6 | MIT | transitive | dev | OK |
| @types/d3-chord | 3.0.6 | MIT | transitive | dev | OK |
| @types/d3-color | 3.1.3 | MIT | transitive | dev | OK |
| @types/d3-contour | 3.0.6 | MIT | transitive | dev | OK |
| @types/d3-delaunay | 6.0.4 | MIT | transitive | dev | OK |
| @types/d3-dispatch | 3.0.7 | MIT | transitive | dev | OK |
| @types/d3-drag | 3.0.7 | MIT | transitive | dev | OK |
| @types/d3-dsv | 3.0.7 | MIT | transitive | dev | OK |
| @types/d3-ease | 3.0.2 | MIT | transitive | dev | OK |
| @types/d3-fetch | 3.0.7 | MIT | transitive | dev | OK |
| @types/d3-force | 3.0.10 | MIT | transitive | dev | OK |
| @types/d3-format | 3.0.4 | MIT | transitive | dev | OK |
| @types/d3-geo | 3.1.0 | MIT | transitive | dev | OK |
| @types/d3-hierarchy | 3.1.7 | MIT | transitive | dev | OK |
| @types/d3-interpolate | 3.0.4 | MIT | transitive | dev | OK |
| @types/d3-path | 3.1.1 | MIT | transitive | dev | OK |
| @types/d3-polygon | 3.0.2 | MIT | transitive | dev | OK |
| @types/d3-quadtree | 3.0.6 | MIT | transitive | dev | OK |
| @types/d3-random | 3.0.4 | MIT | transitive | dev | OK |
| @types/d3-scale | 4.0.9 | MIT | transitive | dev | OK |
| @types/d3-scale-chromatic | 3.1.0 | MIT | transitive | dev | OK |
| @types/d3-selection | 3.0.11 | MIT | transitive | dev | OK |
| @types/d3-shape | 3.1.8 | MIT | transitive | dev | OK |
| @types/d3-time | 3.0.4 | MIT | transitive | dev | OK |
| @types/d3-time-format | 4.0.3 | MIT | transitive | dev | OK |
| @types/d3-timer | 3.0.2 | MIT | transitive | dev | OK |
| @types/d3-transition | 3.0.9 | MIT | transitive | dev | OK |
| @types/d3-zoom | 3.0.8 | MIT | transitive | dev | OK |
| @types/debug | 4.1.13 | MIT | transitive | dev | OK |
| @types/deep-eql | 4.0.2 | MIT | transitive | dev | OK |
| @types/esrecurse | 4.3.1 | MIT | transitive | dev | OK |
| @types/estree | 1.0.9 | MIT | transitive | dev | OK |
| @types/fs-extra | 9.0.13 | MIT | transitive | dev | OK |
| @types/geojson | 7946.0.16 | MIT | transitive | dev | OK |
| @types/http-cache-semantics | 4.2.0 | MIT | transitive | dev | OK |
| @types/istanbul-lib-coverage | 2.0.6 | MIT | transitive | dev | OK |
| @types/json-schema | 7.0.15 | MIT | transitive | dev | OK |
| @types/keyv | 3.1.4 | MIT | transitive | dev | OK |
| @types/ms | 2.1.0 | MIT | transitive | dev | OK |
| @types/node | 24.12.4 | MIT | transitive | dev | OK |
| @types/responselike | 1.0.3 | MIT | transitive | dev | OK |
| @types/sarif | 2.1.7 | MIT | transitive | dev | OK |
| @types/trusted-types | 2.0.7 | MIT | transitive | dev | OK |
| @upsetjs/venn.js | 2.0.0 | MIT | transitive | dev | OK |
| @vitest/coverage-v8 | 4.1.10 | MIT | direct | dev | OK |
| @vitest/expect | 4.1.10 | MIT | transitive | dev | OK |
| @vitest/mocker | 4.1.10 | MIT | transitive | dev | OK |
| @vitest/pretty-format | 4.1.10 | MIT | transitive | dev | OK |
| @vitest/runner | 4.1.10 | MIT | transitive | dev | OK |
| @vitest/snapshot | 4.1.10 | MIT | transitive | dev | OK |
| @vitest/spy | 4.1.10 | MIT | transitive | dev | OK |
| @vitest/utils | 4.1.10 | MIT | transitive | dev | OK |
| @xmldom/xmldom | 0.8.13 | MIT | transitive | dev | OK |
| abbrev | 4.0.0 | ISC | transitive | dev | OK |
| acorn | 7.4.1 | MIT | transitive | dev | OK |
| acorn | 8.16.0 | MIT | transitive | dev | OK |
| acorn-jsx | 5.3.2 | MIT | transitive | dev | OK |
| agent-base | 7.1.4 | MIT | transitive | dev | OK |
| ajv | 6.15.0 | MIT | transitive | dev | OK |
| ajv | 8.18.0 | MIT | transitive | dev | OK |
| ajv | 8.20.0 | MIT | transitive | dev | OK |
| angular-html-parser | 10.4.0 | MIT | transitive | dev | OK |
| ansi-regex | 5.0.1 | MIT | transitive | dev | OK |
| ansi-styles | 4.3.0 | MIT | transitive | dev | OK |
| app-builder-lib | 26.15.3 | MIT | transitive | dev | OK |
| argparse | 2.0.1 | Python-2.0 | transitive | dev | OK |
| asap | 2.0.6 | MIT | transitive | dev | OK |
| asn1js | 3.0.10 | BSD-3-Clause | transitive | dev | OK |
| assert-never | 1.4.0 | MIT | transitive | dev | OK |
| assertion-error | 2.0.1 | MIT | transitive | dev | OK |
| ast-v8-to-istanbul | 1.0.2 | MIT | transitive | dev | OK |
| async | 3.2.6 | MIT | transitive | dev | OK |
| async-exit-hook | 2.0.1 | MIT | transitive | dev | OK |
| asynckit | 0.4.0 | MIT | transitive | dev | OK |
| at-least-node | 1.0.0 | ISC | transitive | dev | OK |
| aws4 | 1.13.2 | MIT | transitive | dev | OK |
| babel-walk | 3.0.0-canary-5 | MIT | transitive | dev | OK |
| badgen | 3.3.2 | MIT | transitive | dev | OK |
| balanced-match | 1.0.2 | MIT | transitive | dev | OK |
| balanced-match | 4.0.4 | MIT | transitive | dev | OK |
| base64-js | 1.5.1 | MIT | transitive | dev | OK |
| baseline-browser-mapping | 2.10.32 | Apache-2.0 | transitive | dev | OK |
| bidi-js | 1.0.3 | MIT | transitive | dev | OK |
| blamer | 1.0.7 | MIT | transitive | dev | OK |
| bluebird | 3.7.2 | MIT | transitive | dev | OK |
| boolean | 3.2.0 | MIT | transitive | dev | OK |
| brace-expansion | 1.1.16 | MIT | transitive | dev | OK |
| brace-expansion | 2.1.2 | MIT | transitive | dev | OK |
| brace-expansion | 5.0.7 | MIT | transitive | dev | OK |
| braces | 3.0.3 | MIT | transitive | dev | OK |
| browserslist | 4.28.2 | MIT | transitive | dev | OK |
| buffer-from | 1.1.2 | MIT | transitive | dev | OK |
| builder-util | 26.15.3 | MIT | transitive | dev | OK |
| builder-util-runtime | 9.7.0 | MIT | transitive | dev | OK |
| bytes | 3.1.2 | MIT | transitive | dev | OK |
| bytestreamjs | 2.0.1 | BSD-3-Clause | transitive | dev | OK |
| cacheable-lookup | 5.0.4 | MIT | transitive | dev | OK |
| cacheable-request | 7.0.4 | MIT | transitive | dev | OK |
| call-bind-apply-helpers | 1.0.2 | MIT | transitive | dev | OK |
| call-bound | 1.0.4 | MIT | transitive | dev | OK |
| chai | 6.2.2 | MIT | transitive | dev | OK |
| chalk | 4.1.2 | MIT | transitive | dev | OK |
| chalk | 5.6.2 | MIT | transitive | dev | OK |
| character-parser | 2.2.0 | MIT | transitive | dev | OK |
| chardet | 2.1.1 | MIT | transitive | dev | OK |
| chownr | 3.0.0 | BlueOak-1.0.0 | transitive | dev | OK |
| chromium-pickle-js | 0.2.0 | MIT | transitive | dev | OK |
| ci-info | 4.3.1 | MIT | transitive | dev | OK |
| ci-info | 4.4.0 | MIT | transitive | dev | OK |
| cli-table3 | 0.6.5 | MIT | transitive | dev | OK |
| cli-width | 4.1.0 | ISC | transitive | dev | OK |
| cliui | 8.0.1 | ISC | transitive | dev | OK |
| clone-response | 1.0.3 | MIT | transitive | dev | OK |
| color-convert | 2.0.1 | MIT | transitive | dev | OK |
| color-name | 1.1.4 | MIT | transitive | dev | OK |
| colors | 1.4.0 | MIT | transitive | dev | OK |
| combined-stream | 1.0.8 | MIT | transitive | dev | OK |
| commander | 14.0.3 | MIT | transitive | dev | OK |
| commander | 15.0.0 | MIT | transitive | dev | OK |
| commander | 5.1.0 | MIT | transitive | dev | OK |
| commander | 7.2.0 | MIT | transitive | dev | OK |
| commander | 8.3.0 | MIT | transitive | dev | OK |
| commander | 9.5.0 | MIT | transitive | dev | OK |
| compare-version | 0.1.2 | MIT | transitive | dev | OK |
| concat-map | 0.0.1 | MIT | transitive | dev | OK |
| constantinople | 4.0.1 | MIT | transitive | dev | OK |
| convert-source-map | 2.0.0 | MIT | transitive | dev | OK |
| core-util-is | 1.0.3 | MIT | transitive | dev | OK |
| cose-base | 1.0.3 | MIT | transitive | dev | OK |
| cose-base | 2.2.0 | MIT | transitive | dev | OK |
| crelt | 1.0.6 | MIT | transitive | dev | OK |
| cross-dirname | 0.1.0 | MIT | transitive | dev | OK |
| cross-spawn | 7.0.6 | MIT | transitive | dev | OK |
| css-tree | 3.2.1 | MIT | transitive | dev | OK |
| cytoscape | 3.34.0 | MIT | transitive | dev | OK |
| cytoscape-cose-bilkent | 4.1.0 | MIT | transitive | dev | OK |
| cytoscape-fcose | 2.2.0 | MIT | transitive | dev | OK |
| d3 | 7.9.0 | ISC | transitive | dev | OK |
| d3-array | 2.12.1 | BSD-3-Clause | transitive | dev | OK |
| d3-array | 3.2.4 | ISC | transitive | dev | OK |
| d3-axis | 3.0.0 | ISC | transitive | dev | OK |
| d3-brush | 3.0.0 | ISC | transitive | dev | OK |
| d3-chord | 3.0.1 | ISC | transitive | dev | OK |
| d3-color | 3.1.0 | ISC | transitive | dev | OK |
| d3-contour | 4.0.2 | ISC | transitive | dev | OK |
| d3-delaunay | 6.0.4 | ISC | transitive | dev | OK |
| d3-dispatch | 3.0.1 | ISC | transitive | dev | OK |
| d3-drag | 3.0.0 | ISC | transitive | dev | OK |
| d3-dsv | 3.0.1 | ISC | transitive | dev | OK |
| d3-ease | 3.0.1 | BSD-3-Clause | transitive | dev | OK |
| d3-fetch | 3.0.1 | ISC | transitive | dev | OK |
| d3-force | 3.0.0 | ISC | transitive | dev | OK |
| d3-format | 3.1.2 | ISC | transitive | dev | OK |
| d3-geo | 3.1.1 | ISC | transitive | dev | OK |
| d3-hierarchy | 3.1.2 | ISC | transitive | dev | OK |
| d3-interpolate | 3.0.1 | ISC | transitive | dev | OK |
| d3-path | 1.0.9 | BSD-3-Clause | transitive | dev | OK |
| d3-path | 3.1.0 | ISC | transitive | dev | OK |
| d3-polygon | 3.0.1 | ISC | transitive | dev | OK |
| d3-quadtree | 3.0.1 | ISC | transitive | dev | OK |
| d3-random | 3.0.1 | ISC | transitive | dev | OK |
| d3-sankey | 0.12.3 | BSD-3-Clause | transitive | dev | OK |
| d3-scale | 4.0.2 | ISC | transitive | dev | OK |
| d3-scale-chromatic | 3.1.0 | ISC | transitive | dev | OK |
| d3-selection | 3.0.0 | ISC | transitive | dev | OK |
| d3-shape | 1.3.7 | BSD-3-Clause | transitive | dev | OK |
| d3-shape | 3.2.0 | ISC | transitive | dev | OK |
| d3-time | 3.1.0 | ISC | transitive | dev | OK |
| d3-time-format | 4.1.0 | ISC | transitive | dev | OK |
| d3-timer | 3.0.1 | ISC | transitive | dev | OK |
| d3-transition | 3.0.1 | ISC | transitive | dev | OK |
| d3-zoom | 3.0.0 | ISC | transitive | dev | OK |
| dagre-d3-es | 7.0.14 | MIT | transitive | dev | OK |
| data-urls | 7.0.0 | MIT | transitive | dev | OK |
| dayjs | 1.11.21 | MIT | transitive | dev | OK |
| debug | 4.4.3 | MIT | transitive | dev | OK |
| decimal.js | 10.6.0 | MIT | transitive | dev | OK |
| decompress-response | 6.0.0 | MIT | transitive | dev | OK |
| deep-is | 0.1.4 | MIT | transitive | dev | OK |
| defer-to-connect | 2.0.1 | MIT | transitive | dev | OK |
| define-data-property | 1.1.4 | MIT | transitive | dev | OK |
| define-properties | 1.2.1 | MIT | transitive | dev | OK |
| delaunator | 5.1.0 | ISC | transitive | dev | OK |
| delayed-stream | 1.0.0 | MIT | transitive | dev | OK |
| des.js | 1.1.0 | MIT | transitive | dev | OK |
| detect-libc | 2.1.2 | Apache-2.0 | transitive | dev | OK |
| detect-node | 2.1.0 | MIT | transitive | dev | OK |
| diff-match-patch | 1.0.5 | Apache-2.0 | transitive | dev | OK |
| dir-compare | 4.2.0 | MIT | transitive | dev | OK |
| dmg-builder | 26.15.3 | MIT | transitive | dev | OK |
| doctypes | 1.1.0 | MIT | transitive | dev | OK |
| dom-serializer | 2.0.0 | MIT | transitive | dev | OK |
| domelementtype | 2.3.0 | BSD-2-Clause | transitive | dev | OK |
| domhandler | 5.0.3 | BSD-2-Clause | transitive | dev | OK |
| dompurify | 3.4.12 | (MPL-2.0 OR Apache-2.0) | direct | dev (vendored->shipped) | OK |
| domutils | 3.2.2 | BSD-2-Clause | transitive | dev | OK |
| dotenv | 16.6.1 | BSD-2-Clause | transitive | dev | OK |
| dotenv-expand | 11.0.7 | BSD-2-Clause | transitive | dev | OK |
| dunder-proto | 1.0.1 | MIT | transitive | dev | OK |
| duplexer2 | 0.1.4 | BSD-3-Clause | transitive | dev | OK |
| ejs | 3.1.10 | Apache-2.0 | transitive | dev | OK |
| electron | 42.7.0 | MIT | direct | dev | OK |
| electron-builder | 26.15.3 | MIT | direct | dev | OK |
| electron-builder-squirrel-windows | 26.15.3 | MIT | transitive | dev | OK |
| electron-publish | 26.15.3 | MIT | transitive | dev | OK |
| electron-to-chromium | 1.5.361 | ISC | transitive | dev | OK |
| electron-winstaller | 5.4.0 | MIT | transitive | dev | OK |
| emoji-regex | 10.6.0 | MIT | transitive | dev | OK |
| emoji-regex | 8.0.0 | MIT | transitive | dev | OK |
| end-of-stream | 1.4.5 | MIT | transitive | dev | OK |
| entities | 4.5.0 | BSD-2-Clause | transitive | dev | OK |
| entities | 7.0.1 | BSD-2-Clause | transitive | dev | OK |
| entities | 8.0.0 | BSD-2-Clause | transitive | dev | OK |
| env-paths | 2.2.1 | MIT | transitive | dev | OK |
| env-paths | 3.0.0 | MIT | transitive | dev | OK |
| err-code | 2.0.3 | MIT | transitive | dev | OK |
| es-define-property | 1.0.1 | MIT | transitive | dev | OK |
| es-errors | 1.3.0 | MIT | transitive | dev | OK |
| es-module-lexer | 2.1.0 | MIT | transitive | dev | OK |
| es-object-atoms | 1.1.1 | MIT | transitive | dev | OK |
| es-set-tostringtag | 2.1.0 | MIT | transitive | dev | OK |
| es-toolkit | 1.49.0 | MIT | transitive | dev | OK |
| es6-error | 4.1.1 | MIT | transitive | dev | OK |
| esbuild | 0.28.1 | MIT | direct | dev | OK |
| escalade | 3.2.0 | MIT | transitive | dev | OK |
| escape-string-regexp | 4.0.0 | MIT | transitive | dev | OK |
| eslint | 10.7.0 | MIT | direct | dev | OK |
| eslint-plugin-html | 8.1.4 | ISC | direct | dev | OK |
| eslint-plugin-security | 4.0.1 | Apache-2.0 | direct | dev | OK |
| eslint-scope | 9.1.2 | BSD-2-Clause | transitive | dev | OK |
| eslint-visitor-keys | 3.4.3 | Apache-2.0 | transitive | dev | OK |
| eslint-visitor-keys | 5.0.1 | Apache-2.0 | transitive | dev | OK |
| espree | 11.2.0 | BSD-2-Clause | transitive | dev | OK |
| esquery | 1.7.0 | BSD-3-Clause | transitive | dev | OK |
| esrecurse | 4.3.0 | BSD-2-Clause | transitive | dev | OK |
| estraverse | 5.3.0 | BSD-2-Clause | transitive | dev | OK |
| estree-walker | 3.0.3 | MIT | transitive | dev | OK |
| esutils | 2.0.3 | BSD-2-Clause | transitive | dev | OK |
| eventemitter3 | 5.0.4 | MIT | transitive | dev | OK |
| execa | 4.1.0 | MIT | transitive | dev | OK |
| execa | 9.6.1 | MIT | transitive | dev | OK |
| expect-type | 1.3.0 | Apache-2.0 | transitive | dev | OK |
| exponential-backoff | 3.1.3 | Apache-2.0 | transitive | dev | OK |
| fast-check | 4.9.0 | MIT | direct | dev | OK |
| fast-deep-equal | 3.1.3 | MIT | transitive | dev | OK |
| fast-glob | 3.3.3 | MIT | transitive | dev | OK |
| fast-json-stable-stringify | 2.1.0 | MIT | transitive | dev | OK |
| fast-levenshtein | 2.0.6 | MIT | transitive | dev | OK |
| fast-string-truncated-width | 3.0.3 | MIT | transitive | dev | OK |
| fast-string-width | 3.0.2 | MIT | transitive | dev | OK |
| fast-uri | 3.1.4 | BSD-3-Clause | transitive | dev | OK |
| fast-wrap-ansi | 0.2.2 | MIT | transitive | dev | OK |
| fastq | 1.20.1 | ISC | transitive | dev | OK |
| fdir | 6.5.0 | MIT | transitive | dev | OK |
| figures | 6.1.0 | MIT | transitive | dev | OK |
| file-entry-cache | 8.0.0 | MIT | transitive | dev | OK |
| filelist | 1.0.6 | Apache-2.0 | transitive | dev | OK |
| fill-range | 7.1.1 | MIT | transitive | dev | OK |
| find-up | 5.0.0 | MIT | transitive | dev | OK |
| flat-cache | 4.0.1 | MIT | transitive | dev | OK |
| flatted | 3.4.2 | ISC | transitive | dev | OK |
| form-data | 4.0.6 | MIT | transitive | dev | OK |
| fs-extra | 10.1.0 | MIT | transitive | dev | OK |
| fs-extra | 11.3.1 | MIT | transitive | dev | OK |
| fs-extra | 11.3.6 | MIT | transitive | dev | OK |
| fs-extra | 7.0.1 | MIT | transitive | dev | OK |
| fs-extra | 8.1.0 | MIT | transitive | dev | OK |
| fs-extra | 9.1.0 | MIT | transitive | dev | OK |
| fs.realpath | 1.0.0 | ISC | transitive | dev | OK |
| function-bind | 1.1.2 | MIT | transitive | dev | OK |
| gensync | 1.0.0-beta.2 | MIT | transitive | dev | OK |
| get-caller-file | 2.0.5 | ISC | transitive | dev | OK |
| get-intrinsic | 1.3.0 | MIT | transitive | dev | OK |
| get-proto | 1.0.1 | MIT | transitive | dev | OK |
| get-stream | 5.2.0 | MIT | transitive | dev | OK |
| get-stream | 9.0.1 | MIT | transitive | dev | OK |
| glob | 7.2.3 | ISC | transitive | dev | OK |
| glob-parent | 5.1.2 | ISC | transitive | dev | OK |
| glob-parent | 6.0.2 | ISC | transitive | dev | OK |
| global-agent | 3.0.0 | BSD-3-Clause | transitive | dev | OK |
| globalthis | 1.0.4 | MIT | transitive | dev | OK |
| gopd | 1.2.0 | MIT | transitive | dev | OK |
| got | 11.8.6 | MIT | transitive | dev | OK |
| graceful-fs | 4.2.11 | ISC | transitive | dev | OK |
| hachure-fill | 0.5.2 | MIT | transitive | dev | OK |
| has-flag | 4.0.0 | MIT | transitive | dev | OK |
| has-property-descriptors | 1.0.2 | MIT | transitive | dev | OK |
| has-symbols | 1.1.0 | MIT | transitive | dev | OK |
| has-tostringtag | 1.0.2 | MIT | transitive | dev | OK |
| hasown | 2.0.3 | MIT | transitive | dev | OK |
| hasown | 2.0.4 | MIT | transitive | dev | OK |
| highlight.js | 11.11.1 | BSD-3-Clause | direct | dev (vendored->shipped) | OK |
| hosted-git-info | 4.1.0 | ISC | transitive | dev | OK |
| html-encoding-sniffer | 6.0.0 | MIT | transitive | dev | OK |
| html-escaper | 2.0.2 | MIT | transitive | dev | OK |
| htmlparser2 | 10.1.0 | MIT | transitive | dev | OK |
| http-cache-semantics | 4.2.0 | BSD-2-Clause | transitive | dev | OK |
| http-proxy-agent | 7.0.2 | MIT | transitive | dev | OK |
| http2-wrapper | 1.0.3 | MIT | transitive | dev | OK |
| https-proxy-agent | 7.0.6 | MIT | transitive | dev | OK |
| human-signals | 1.1.1 | Apache-2.0 | transitive | dev | OK |
| human-signals | 8.0.1 | Apache-2.0 | transitive | dev | OK |
| iconv-lite | 0.6.3 | MIT | transitive | dev | OK |
| iconv-lite | 0.7.2 | MIT | transitive | dev | OK |
| ignore | 5.3.2 | MIT | transitive | dev | OK |
| import-meta-resolve | 4.2.0 | MIT | transitive | dev | OK |
| imurmurhash | 0.1.4 | MIT | transitive | dev | OK |
| inflight | 1.0.6 | ISC | transitive | dev | OK |
| inherits | 2.0.4 | ISC | transitive | dev | OK |
| internmap | 1.0.1 | ISC | transitive | dev | OK |
| internmap | 2.0.3 | ISC | transitive | dev | OK |
| is-core-module | 2.16.2 | MIT | transitive | dev | OK |
| is-expression | 4.0.0 | MIT | transitive | dev | OK |
| is-extglob | 2.1.1 | MIT | transitive | dev | OK |
| is-fullwidth-code-point | 3.0.0 | MIT | transitive | dev | OK |
| is-glob | 4.0.3 | MIT | transitive | dev | OK |
| is-number | 7.0.0 | MIT | transitive | dev | OK |
| is-plain-obj | 4.1.0 | MIT | transitive | dev | OK |
| is-potential-custom-element-name | 1.0.1 | MIT | transitive | dev | OK |
| is-promise | 2.2.2 | MIT | transitive | dev | OK |
| is-regex | 1.2.1 | MIT | transitive | dev | OK |
| is-stream | 2.0.1 | MIT | transitive | dev | OK |
| is-stream | 4.0.1 | MIT | transitive | dev | OK |
| is-unicode-supported | 2.1.0 | MIT | transitive | dev | OK |
| isarray | 1.0.0 | MIT | transitive | dev | OK |
| isbinaryfile | 4.0.10 | MIT | transitive | dev | OK |
| isbinaryfile | 5.0.7 | MIT | transitive | dev | OK |
| isexe | 2.0.0 | ISC | transitive | dev | OK |
| isexe | 3.1.5 | BlueOak-1.0.0 | transitive | dev | OK |
| isexe | 4.0.0 | BlueOak-1.0.0 | transitive | dev | OK |
| istanbul-lib-coverage | 3.2.2 | BSD-3-Clause | direct | dev | OK |
| istanbul-lib-report | 3.0.1 | BSD-3-Clause | direct | dev | OK |
| istanbul-reports | 3.2.0 | BSD-3-Clause | direct | dev | OK |
| jake | 10.9.4 | Apache-2.0 | transitive | dev | OK |
| jiti | 2.7.0 | MIT | transitive | dev | OK |
| js-md4 | 0.3.2 | MIT | transitive | dev | OK |
| js-stringify | 1.0.2 | MIT | transitive | dev | OK |
| js-tokens | 10.0.0 | MIT | transitive | dev | OK |
| js-tokens | 4.0.0 | MIT | transitive | dev | OK |
| js-yaml | 4.3.0 | MIT | transitive | dev | OK |
| jscpd | 4.2.5 | MIT | direct | dev | OK |
| jscpd-sarif-reporter | 4.2.5 | MIT | transitive | dev | OK |
| jsdom | 29.1.1 | MIT | direct | dev | OK |
| jsesc | 3.1.0 | MIT | transitive | dev | OK |
| json-buffer | 3.0.1 | MIT | transitive | dev | OK |
| json-rpc-2.0 | 1.7.1 | MIT | transitive | dev | OK |
| json-schema-traverse | 0.4.1 | MIT | transitive | dev | OK |
| json-schema-traverse | 1.0.0 | MIT | transitive | dev | OK |
| json-stable-stringify-without-jsonify | 1.0.1 | MIT | transitive | dev | OK |
| json-stringify-safe | 5.0.1 | ISC | transitive | dev | OK |
| json5 | 2.2.3 | MIT | transitive | dev | OK |
| jsonfile | 4.0.0 | MIT | transitive | dev | OK |
| jsonfile | 6.2.1 | MIT | transitive | dev | OK |
| jstransformer | 1.0.0 | MIT | transitive | dev | OK |
| katex | 0.16.47 | MIT | transitive | dev (vendored->shipped) | OK |
| katex | 0.17.0 | MIT | direct | dev (vendored->shipped) | OK |
| keyv | 4.5.4 | MIT | transitive | dev | OK |
| khroma | 2.1.0 | MIT* | transitive | dev | OK |
| layout-base | 1.0.2 | MIT | transitive | dev | OK |
| layout-base | 2.0.1 | MIT | transitive | dev | OK |
| lazy-val | 1.0.5 | MIT | transitive | dev | OK |
| levn | 0.4.1 | MIT | transitive | dev | OK |
| locate-path | 6.0.0 | MIT | transitive | dev | OK |
| lodash | 4.18.1 | MIT | transitive | dev | OK |
| lodash-es | 4.18.1 | MIT | transitive | dev | OK |
| lodash.groupby | 4.6.0 | MIT | transitive | dev | OK |
| lowercase-keys | 2.0.0 | MIT | transitive | dev | OK |
| lru-cache | 11.5.0 | BlueOak-1.0.0 | transitive | dev | OK |
| lru-cache | 5.1.1 | ISC | transitive | dev | OK |
| lru-cache | 6.0.0 | ISC | transitive | dev | OK |
| lucide-static | 1.25.0 | ISC | direct | dev | OK |
| magic-string | 0.30.21 | MIT | transitive | dev | OK |
| magicast | 0.5.3 | MIT | transitive | dev | OK |
| make-dir | 4.0.0 | MIT | transitive | dev | OK |
| markdown-table | 2.0.0 | MIT | transitive | dev | OK |
| marked | 16.4.2 | MIT | transitive | dev (vendored->shipped) | OK |
| marked | 18.0.6 | MIT | direct | dev (vendored->shipped) | OK |
| matcher | 3.0.0 | MIT | transitive | dev | OK |
| math-intrinsics | 1.1.0 | MIT | transitive | dev | OK |
| mdn-data | 2.27.1 | CC0-1.0 | transitive | dev | OK |
| merge-stream | 2.0.0 | MIT | transitive | dev | OK |
| merge2 | 1.4.1 | MIT | transitive | dev | OK |
| mermaid | 11.15.0 | MIT | direct | dev (vendored->shipped) | OK |
| micromatch | 4.0.8 | MIT | transitive | dev | OK |
| mime | 2.6.0 | MIT | transitive | dev | OK |
| mime-db | 1.52.0 | MIT | transitive | dev | OK |
| mime-types | 2.1.35 | MIT | transitive | dev | OK |
| mimic-fn | 2.1.0 | MIT | transitive | dev | OK |
| mimic-response | 1.0.1 | MIT | transitive | dev | OK |
| mimic-response | 3.1.0 | MIT | transitive | dev | OK |
| minimalistic-assert | 1.0.1 | ISC | transitive | dev | OK |
| minimatch | 10.2.5 | BlueOak-1.0.0 | transitive | dev | OK |
| minimatch | 3.1.5 | ISC | transitive | dev | OK |
| minimatch | 5.1.9 | ISC | transitive | dev | OK |
| minimatch | 9.0.9 | ISC | transitive | dev | OK |
| minimist | 1.2.8 | MIT | transitive | dev | OK |
| minipass | 7.1.3 | BlueOak-1.0.0 | transitive | dev | OK |
| minizlib | 3.1.0 | MIT | transitive | dev | OK |
| mkdirp | 0.5.6 | MIT | transitive | dev | OK |
| ms | 2.1.3 | MIT | transitive | dev | OK |
| mutation-server-protocol | 0.4.1 | Apache-2.0 | transitive | dev | OK |
| mutation-testing-elements | 3.7.3 | Apache-2.0 | transitive | dev | OK |
| mutation-testing-metrics | 3.7.3 | Apache-2.0 | transitive | dev | OK |
| mutation-testing-report-schema | 3.7.3 | Apache-2.0 | transitive | dev | OK |
| mute-stream | 4.0.0 | ISC | transitive | dev | OK |
| nanoid | 3.3.16 | MIT | transitive | dev | OK |
| natural-compare | 1.4.0 | MIT | transitive | dev | OK |
| node-abi | 4.33.0 | MIT | transitive | dev | OK |
| node-api-version | 0.2.1 | MIT | transitive | dev | OK |
| node-gyp | 12.4.0 | MIT | transitive | dev | OK |
| node-int64 | 0.4.0 | MIT | transitive | dev | OK |
| node-releases | 2.0.46 | MIT | transitive | dev | OK |
| node-sarif-builder | 4.1.0 | MIT | transitive | dev | OK |
| nopt | 9.0.0 | ISC | transitive | dev | OK |
| normalize-url | 6.1.0 | MIT | transitive | dev | OK |
| npm-run-path | 4.0.1 | MIT | transitive | dev | OK |
| npm-run-path | 6.0.0 | MIT | transitive | dev | OK |
| object-assign | 4.1.1 | MIT | transitive | dev | OK |
| object-inspect | 1.13.4 | MIT | transitive | dev | OK |
| object-keys | 1.1.1 | MIT | transitive | dev | OK |
| obug | 2.1.1 | MIT | transitive | dev | OK |
| once | 1.4.0 | ISC | transitive | dev | OK |
| onetime | 5.1.2 | MIT | transitive | dev | OK |
| optionator | 0.9.4 | MIT | transitive | dev | OK |
| p-cancelable | 2.1.1 | MIT | transitive | dev | OK |
| p-limit | 3.1.0 | MIT | transitive | dev | OK |
| p-locate | 5.0.0 | MIT | transitive | dev | OK |
| package-manager-detector | 1.7.0 | MIT | transitive | dev | OK |
| parse-ms | 4.0.0 | MIT | transitive | dev | OK |
| parse5 | 8.0.1 | MIT | transitive | dev | OK |
| path-data-parser | 0.1.0 | MIT | transitive | dev | OK |
| path-exists | 4.0.0 | MIT | transitive | dev | OK |
| path-is-absolute | 1.0.1 | MIT | transitive | dev | OK |
| path-key | 3.1.1 | MIT | transitive | dev | OK |
| path-key | 4.0.0 | MIT | transitive | dev | OK |
| path-parse | 1.0.7 | MIT | transitive | dev | OK |
| pathe | 2.0.3 | MIT | transitive | dev | OK |
| pe-library | 0.4.1 | MIT | transitive | dev | OK |
| picocolors | 1.1.1 | ISC | transitive | dev | OK |
| picomatch | 2.3.2 | MIT | transitive | dev | OK |
| picomatch | 4.0.5 | MIT | transitive | dev | OK |
| pkijs | 3.4.0 | BSD-3-Clause | transitive | dev | OK |
| playwright | 1.61.1 | Apache-2.0 | transitive | dev | OK |
| playwright-core | 1.61.1 | Apache-2.0 | transitive | dev | OK |
| plist | 3.1.0 | MIT | transitive | dev | OK |
| points-on-curve | 0.2.0 | MIT | transitive | dev | OK |
| points-on-path | 0.2.1 | MIT | transitive | dev | OK |
| postcss | 8.5.20 | MIT | transitive | dev | OK |
| postject | 1.0.0-alpha.6 | MIT | transitive | dev | OK |
| prelude-ls | 1.2.1 | MIT | transitive | dev | OK |
| pretty-ms | 9.3.0 | MIT | transitive | dev | OK |
| proc-log | 6.1.0 | ISC | transitive | dev | OK |
| process-nextick-args | 2.0.1 | MIT | transitive | dev | OK |
| progress | 2.0.3 | MIT | transitive | dev | OK |
| promise | 7.3.1 | MIT | transitive | dev | OK |
| promise-retry | 2.0.1 | MIT | transitive | dev | OK |
| proper-lockfile | 4.1.2 | MIT | transitive | dev | OK |
| pug | 3.0.4 | MIT | transitive | dev | OK |
| pug-attrs | 3.0.0 | MIT | transitive | dev | OK |
| pug-code-gen | 3.0.4 | MIT | transitive | dev | OK |
| pug-error | 2.1.0 | MIT | transitive | dev | OK |
| pug-filters | 4.0.0 | MIT | transitive | dev | OK |
| pug-lexer | 5.0.1 | MIT | transitive | dev | OK |
| pug-linker | 4.0.0 | MIT | transitive | dev | OK |
| pug-load | 3.0.0 | MIT | transitive | dev | OK |
| pug-parser | 6.0.0 | MIT | transitive | dev | OK |
| pug-runtime | 3.0.1 | MIT | transitive | dev | OK |
| pug-strip-comments | 2.0.0 | MIT | transitive | dev | OK |
| pug-walk | 2.0.0 | MIT | transitive | dev | OK |
| pump | 3.0.4 | MIT | transitive | dev | OK |
| punycode | 2.3.1 | MIT | transitive | dev | OK |
| pure-rand | 8.4.0 | MIT | transitive | dev | OK |
| pvtsutils | 1.3.6 | MIT | transitive | dev | OK |
| pvutils | 1.1.5 | MIT | transitive | dev | OK |
| qs | 6.15.2 | BSD-3-Clause | transitive | dev | OK |
| queue-microtask | 1.2.3 | MIT | transitive | dev | OK |
| quick-lru | 5.1.1 | MIT | transitive | dev | OK |
| read-binary-file-arch | 1.0.6 | MIT | transitive | dev | OK |
| readable-stream | 2.3.8 | MIT | transitive | dev | OK |
| regexp-tree | 0.1.27 | MIT | transitive | dev | OK |
| repeat-string | 1.6.1 | MIT | transitive | dev | OK |
| require-directory | 2.1.1 | MIT | transitive | dev | OK |
| require-from-string | 2.0.2 | MIT | transitive | dev | OK |
| resedit | 1.7.2 | MIT | transitive | dev | OK |
| resolve | 1.22.12 | MIT | transitive | dev | OK |
| resolve-alpn | 1.2.1 | MIT | transitive | dev | OK |
| responselike | 2.0.1 | MIT | transitive | dev | OK |
| retry | 0.12.0 | MIT | transitive | dev | OK |
| reusify | 1.1.0 | MIT | transitive | dev | OK |
| rimraf | 2.6.3 | ISC | transitive | dev | OK |
| roarr | 2.15.4 | BSD-3-Clause | transitive | dev | OK |
| robust-predicates | 3.0.3 | Unlicense | transitive | dev | OK |
| rolldown | 1.1.5 | MIT | transitive | dev | OK |
| roughjs | 4.6.6 | MIT | transitive | dev | OK |
| run-parallel | 1.2.0 | MIT | transitive | dev | OK |
| rw | 1.3.3 | BSD-3-Clause | transitive | dev | OK |
| rxjs | 7.8.2 | Apache-2.0 | transitive | dev | OK |
| safe-buffer | 5.1.2 | MIT | transitive | dev | OK |
| safe-regex | 2.1.1 | MIT | transitive | dev | OK |
| safer-buffer | 2.1.2 | MIT | transitive | dev | OK |
| sanitize-filename | 1.6.4 | WTFPL OR ISC | transitive | dev | OK |
| sax | 1.6.0 | BlueOak-1.0.0 | transitive | dev | OK |
| saxes | 6.0.0 | ISC | transitive | dev | OK |
| semver | 5.7.2 | ISC | transitive | dev | OK |
| semver | 6.3.1 | ISC | transitive | dev | OK |
| semver | 7.7.4 | ISC | transitive | dev | OK |
| semver | 7.8.1 | ISC | transitive | dev | OK |
| semver | 7.8.5 | ISC | transitive | dev | OK |
| semver-compare | 1.0.0 | MIT | transitive | dev | OK |
| serialize-error | 7.0.1 | MIT | transitive | dev | OK |
| shebang-command | 2.0.0 | MIT | transitive | dev | OK |
| shebang-regex | 3.0.0 | MIT | transitive | dev | OK |
| side-channel | 1.1.0 | MIT | transitive | dev | OK |
| side-channel-list | 1.0.1 | MIT | transitive | dev | OK |
| side-channel-map | 1.0.1 | MIT | transitive | dev | OK |
| side-channel-weakmap | 1.0.2 | MIT | transitive | dev | OK |
| siginfo | 2.0.0 | ISC | transitive | dev | OK |
| signal-exit | 3.0.7 | ISC | transitive | dev | OK |
| signal-exit | 4.1.0 | ISC | transitive | dev | OK |
| simple-update-notifier | 2.0.0 | MIT | transitive | dev | OK |
| source-map | 0.6.1 | BSD-3-Clause | transitive | dev | OK |
| source-map | 0.7.6 | BSD-3-Clause | transitive | dev | OK |
| source-map-js | 1.2.1 | BSD-3-Clause | transitive | dev | OK |
| source-map-support | 0.5.21 | MIT | transitive | dev | OK |
| spark-md5 | 3.0.2 | (WTFPL OR MIT) | transitive | dev | OK |
| sprintf-js | 1.1.3 | BSD-3-Clause | transitive | dev | OK |
| stackback | 0.0.2 | MIT | transitive | dev | OK |
| stat-mode | 1.0.0 | MIT | transitive | dev | OK |
| std-env | 4.1.0 | MIT | transitive | dev | OK |
| string_decoder | 1.1.1 | MIT | transitive | dev | OK |
| string-width | 4.2.3 | MIT | transitive | dev | OK |
| strip-ansi | 6.0.1 | MIT | transitive | dev | OK |
| strip-final-newline | 2.0.0 | MIT | transitive | dev | OK |
| strip-final-newline | 4.0.0 | MIT | transitive | dev | OK |
| style-mod | 4.1.3 | MIT | transitive | dev | OK |
| stylis | 4.4.0 | MIT | transitive | dev | OK |
| sumchecker | 3.0.1 | Apache-2.0 | transitive | dev | OK |
| supports-color | 7.2.0 | MIT | transitive | dev | OK |
| supports-preserve-symlinks-flag | 1.0.0 | MIT | transitive | dev | OK |
| symbol-tree | 3.2.4 | MIT | transitive | dev | OK |
| tar | 7.5.20 | BlueOak-1.0.0 | transitive | dev | OK |
| temp | 0.9.4 | MIT | transitive | dev | OK |
| temp-file | 3.4.0 | MIT | transitive | dev | OK |
| tiny-async-pool | 1.3.0 | MIT | transitive | dev | OK |
| tinybench | 2.9.0 | MIT | transitive | dev | OK |
| tinyexec | 1.2.2 | MIT | transitive | dev | OK |
| tinyglobby | 0.2.17 | MIT | transitive | dev | OK |
| tinyrainbow | 3.1.0 | MIT | transitive | dev | OK |
| tldts | 7.4.0 | MIT | transitive | dev | OK |
| tldts-core | 7.4.0 | MIT | transitive | dev | OK |
| tmp | 0.2.7 | MIT | transitive | dev | OK |
| tmp-promise | 3.0.3 | MIT | transitive | dev | OK |
| to-regex-range | 5.0.1 | MIT | transitive | dev | OK |
| token-stream | 1.0.0 | MIT | transitive | dev | OK |
| tough-cookie | 6.0.1 | BSD-3-Clause | transitive | dev | OK |
| tr46 | 6.0.0 | MIT | transitive | dev | OK |
| tree-kill | 1.2.2 | MIT | transitive | dev | OK |
| truncate-utf8-bytes | 1.0.2 | WTFPL | transitive | dev | OK |
| ts-dedent | 2.3.0 | MIT | transitive | dev | OK |
| tslib | 2.8.1 | 0BSD | transitive | dev | OK |
| tunnel | 0.0.6 | MIT | transitive | dev | OK |
| type-check | 0.4.0 | MIT | transitive | dev | OK |
| type-fest | 0.13.1 | (MIT OR CC0-1.0) | transitive | dev | OK |
| typed-inject | 5.0.0 | Apache-2.0 | transitive | dev | OK |
| typed-rest-client | 2.3.1 | MIT | transitive | dev | OK |
| underscore | 1.13.8 | MIT | transitive | dev | OK |
| undici | 6.27.0 | MIT | transitive | dev | OK |
| undici | 7.28.0 | MIT | transitive | dev | OK |
| undici-types | 7.16.0 | MIT | transitive | dev | OK |
| unicorn-magic | 0.3.0 | MIT | transitive | dev | OK |
| universalify | 0.1.2 | MIT | transitive | dev | OK |
| universalify | 2.0.1 | MIT | transitive | dev | OK |
| unzipper | 0.12.5 | MIT | transitive | dev | OK |
| update-browserslist-db | 1.2.3 | MIT | transitive | dev | OK |
| uri-js | 4.4.1 | BSD-2-Clause | transitive | dev | OK |
| utf8-byte-length | 1.0.5 | (WTFPL OR MIT) | transitive | dev | OK |
| util-deprecate | 1.0.2 | MIT | transitive | dev | OK |
| uuid | 14.0.1 | MIT | transitive | dev | OK |
| v8-to-istanbul | 9.3.0 | ISC | direct | dev | OK |
| vite | 8.1.5 | MIT | transitive | dev | OK |
| vitest | 4.1.10 | MIT | direct | dev | OK |
| void-elements | 3.1.0 | MIT | transitive | dev | OK |
| w3c-keyname | 2.2.8 | MIT | transitive | dev | OK |
| w3c-xmlserializer | 5.0.0 | MIT | transitive | dev | OK |
| weapon-regex | 1.3.6 | Apache-2.0 | transitive | dev | OK |
| webcrypto-core | 1.9.2 | MIT | transitive | dev | OK |
| webidl-conversions | 8.0.1 | BSD-2-Clause | transitive | dev | OK |
| whatwg-mimetype | 5.0.0 | MIT | transitive | dev | OK |
| whatwg-url | 16.0.1 | MIT | transitive | dev | OK |
| which | 2.0.2 | ISC | transitive | dev | OK |
| which | 5.0.0 | ISC | transitive | dev | OK |
| which | 6.0.1 | ISC | transitive | dev | OK |
| why-is-node-running | 2.3.0 | MIT | transitive | dev | OK |
| with | 7.0.2 | MIT | transitive | dev | OK |
| word-wrap | 1.2.5 | MIT | transitive | dev | OK |
| wrap-ansi | 7.0.0 | MIT | transitive | dev | OK |
| wrappy | 1.0.2 | ISC | transitive | dev | OK |
| xml-name-validator | 5.0.0 | Apache-2.0 | transitive | dev | OK |
| xmlbuilder | 15.1.1 | MIT | transitive | dev | OK |
| xmlchars | 2.2.0 | MIT | transitive | dev | OK |
| y18n | 5.0.8 | ISC | transitive | dev | OK |
| yallist | 3.1.1 | ISC | transitive | dev | OK |
| yallist | 4.0.0 | ISC | transitive | dev | OK |
| yallist | 5.0.0 | BlueOak-1.0.0 | transitive | dev | OK |
| yargs | 17.7.2 | MIT | transitive | dev | OK |
| yargs-parser | 21.1.1 | ISC | transitive | dev | OK |
| yocto-queue | 0.1.0 | MIT | transitive | dev | OK |
| yoctocolors | 2.1.2 | MIT | transitive | dev | OK |
| zod | 4.4.3 | MIT | transitive | dev | OK |

## Problems (BLOCKED / UNKNOWN)

**None.** No dependency is BLOCKED (AGPL / SSPL / BUSL / Elastic-2.0 / PolyForm / Commons-Clause / proprietary / no-license) or UNKNOWN. Every dependency carries an identifiable open-source license. No replacements required.

## Review notes (REVIEW bucket — reviewed, no replacement required)

All six REVIEW items are weak / file-level copyleft (MPL-2.0) or attribution (CC-BY-4.0) licenses used purely as **dev / build / test tooling or data**. They are all open source.

**Why none of their obligations trigger — verified, not assumed.** Every "no action" below rests on a single verified fact: **none of these packages are distributed.**

- The project declares **zero production `dependencies`**, so `electron-builder` bundles **no `node_modules`** into the packaged app.
- None of the six appear in the vendored `assets/vendor/**` bundle or in `src/` (checked by grep).
- MPL-2.0 obligations (provide the covered source + retain notices) attach to **distribution of the covered files, modified or not** — modification is *not* the trigger, distribution is. Since these files are never distributed, nothing attaches. Their outputs (transformed CSS, lint/test results) are not "Covered Software" under MPL-2.0 §1, so no obligation flows to them either.
- CC-BY-4.0's attribution duty attaches to **redistribution of the data**; `caniuse-lite` is consumed at build time and never shipped, so the duty never arises.

Each license was confirmed twice: the package `license` SPDX field **and** the on-disk LICENSE-file header ("Mozilla Public License, version 2.0" / "Attribution 4.0 International").

| Package | Version | License | Direct/Transitive | Pulled in by | Assessment (verified) |
|---|---|---|---|---|---|
| @axe-core/playwright | 4.12.1 | MPL-2.0 | direct | dev dep (a11y tests) | Dev/test tool; not distributed → MPL obligations never attach. No action. |
| axe-core | 4.12.1 | MPL-2.0 | direct | dev dep (a11y tests) | Dev/test tool; not distributed → MPL obligations never attach. No action. |
| eslint-plugin-no-unsanitized | 4.1.5 | MPL-2.0 | direct | dev dep (lint) | Dev/lint tool; not distributed → MPL obligations never attach. No action. |
| lightningcss | 1.33.0 | MPL-2.0 | transitive | vitest → vite | Build-time CSS transform; not distributed → MPL obligations never attach. No action. |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 | transitive | lightningcss (native binary) | Build-time native binary; not distributed → MPL obligations never attach. No action. |
| caniuse-lite | 1.0.30001793 | CC-BY-4.0 | transitive | stryker → babel → browserslist | Build-time data; not redistributed → CC-BY attribution duty never arises. No action. |

## Vendored fonts (shipped assets — not npm packages)

Fonts ship inside the packaged app via the `assets/vendor/**` glob, but they are **binary assets, not npm dependencies**, so `license-checker` never inspected them. Reviewed here by hand against the license notices that ship beside them (`assets/vendor/fonts/LICENSES.md` + `assets/vendor/fonts/OFL-1.1.txt`). **All open source.**

| Font family | Files | License | Bucket | Basis |
|---|---|---|---|---|
| Fraunces | 2 (`fraunces-latin-opsz-{normal,italic}`) | OFL-1.1 | OK | Documented in `assets/vendor/fonts/LICENSES.md`; full OFL text shipped |
| Inter | 2 (`inter-latin-wght-{normal,italic}`) | OFL-1.1 | OK | Documented; full OFL text shipped |
| JetBrains Mono | 2 (`jetbrains-mono-latin-wght-{normal,italic}`) | OFL-1.1 | OK | Documented; full OFL text shipped |
| IBM Plex Sans Arabic | 4 (`400/500/600/700`) | OFL-1.1 | OK | Documented; full OFL text shipped |
| KaTeX math fonts (`KaTeX_*`) | 20 | MIT | OK | Ship inside the MIT-licensed `katex` package (katex@0.17.0, already in the table above) |

Notes:
- **SIL OFL-1.1** is a libre / open font license (FSF-free). Its redistribution conditions — ship the license + copyright notice, respect the Reserved Font Names, and don't sell the fonts on their own — are **satisfied**: `LICENSES.md` carries the attribution/copyright per family and `OFL-1.1.txt` carries the full text, both bundled next to the fonts; the fonts are used unmodified (Fontsource latin/arabic subsets) with no renamed derivative; and they are shipped as part of an application, not sold standalone.
- The **KaTeX** math fonts carry no separate license — they are part of the MIT-licensed `katex` distribution, so they inherit MIT (already covered by the `katex` rows in the dependency table).

## Method / reproducibility

```
npx --yes license-checker --json                # all 766 packages
npx --yes license-checker --production --json   # 1 (root only -> no runtime deps)
npx --yes license-checker --development --json  # 766
```

license-checker was run via `npx` (temporary, not added to the project). Buckets follow the audit policy: OK = MIT / Apache-2.0 / BSD-2/3 / ISC / 0BSD / Zlib / Unlicense / CC0 (+ permissive equivalents, noted); REVIEW = MPL / LGPL / GPL / EPL / CDDL / CC-BY; BLOCKED = AGPL / SSPL / BUSL / Elastic-2.0 / PolyForm / Commons-Clause / proprietary / no-license; UNKNOWN = missing or conflicting. No license was ever guessed.
