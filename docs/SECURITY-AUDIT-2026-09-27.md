# Security Audit — 2026-09-27 (hostile, pre-release)

Adversarial audit of the 1.3.0 tree (HEAD `2e21063`) before release. Method: the full
approved scanner suite in WSL2 Ubuntu (gitleaks 8.30.1, trufflehog 3.97.0, semgrep 1.175.0,
syft, grype, osv-scanner, checkov 3.3.16) plus a hostile manual review of every application
boundary — each attack hypothesis stated first, then tested against the code. Raw artifacts:
`.secreports/2026-09-27/`. The previous pass is `docs/SECURITY-SCAN-2026-09-26.md` (HEAD
`4b037b0`); everything that landed since (save-path integrity pass, capability
re-validation, annotations vault-key fix, GATE-02, the 1.3.0 re-version) is covered here.

## Verdict

**No CRITICAL, no HIGH. 4 LOW findings (2 exploitability-limited code gaps, 2
version-currency), 0 unresolved true-positive secrets. Release-blocking issues: none.**

| Phase | Check | Status |
|---|---|---|
| A — Secrets | gitleaks full history (`--all` refs) | CLEAN — 0 findings |
| A — Secrets | gitleaks working tree incl. ignored (1.33 GB) | CLEAN — 0 findings |
| A — Secrets | trufflehog live verification (1.79 GB, 168,238 chunks) | CLEAN — 28 raw, 0 verified, all in untracked `node_modules`/`dist` (docs-example URLs, Electron locale dictionaries, fixture hex) |
| A — Secrets | `npm run audit:secrets` (first-party baseline) | CLEAN — 0 first-party (67 upstream in `node_modules`, untracked, excluded from `build.files`) |
| B — SAST | semgrep auto + p/secrets + p/javascript | 35 findings — identical set to the 2026-09-26 baseline; only delta is two known audit-rule hits moving lines (239→240, 138→148) from this week's edits |
| B — SAST | `npm run lint:security` | GREEN — 222 exact reviewed findings, 0 new/moved |
| B — SAST | checkov (github_actions) + manual review of all 4 workflows | CLEAN — 388 passed, 0 failed; every `uses:` SHA-pinned; least-privilege job-scoped permissions; harden-runner throughout |
| C — Supply chain | osv-scanner recursive | CLEAN — 816 lockfile packages, 0 vulnerabilities |
| C — Supply chain | `npm audit` | CLEAN — 0 vulnerabilities |
| C — Supply chain | grype on fresh SBOM (`--fail-on high`) | 45 rows — **all** the known accepted-risk 7-Zip; nothing else in the SBOM |
| C — Supply chain | lockfile hygiene | CLEAN — 849/849 registry-tarball resolutions, no `git+`/`file:`/`link:`, no `.npmrc`, `vendor:check` + `license:inventory` green |
| D — Hostile code review | D1–D10 (below) | 4 LOW total; every other hypothesis disproven |
| E — Release gates | package:verify / checksums / preflight / Inno lane | VERIFIED — 3 asars, 7 fuses × 3 binaries; canonical-checksum enforcement; fail-closed signing chain |

## Findings (ranked)

| # | Severity | Finding | Evidence | Exploit path | Recommendation |
|---|---|---|---|---|---|
| 1 | LOW | Update-response body has no size cap before `Buffer.concat` + `JSON.parse` | `src/main/github-tls.js:106-114` | Whoever holds the two pinned SPKI keys (a compromised GitHub or key compromise — a network MITM is excluded by the pin) returns a giant body → main-process OOM. Crash-only; the update flow is notify-only | Cap accumulated bytes; reject early |
| 2 | LOW | `update:check` is ungated and unthrottled per call | `src/main/ipc-controller.js:881`, `src/preload/index.js:128` | A compromised renderer loops `checkForUpdate()` → pinned-host GETs at IPC rate. No user data in the request; GitHub's 60/hr unauthenticated limit caps volume | Rate-limit the channel or gate on the update-check setting |
| 3 | LOW | DOMPurify 3.4.13 is inside the affected range of two Low IN_PLACE advisories (fixed 3.4.16) | `resources/vendor/dompurify/purify.min.js`; GHSA-p98j-92pf-mc4p, GHSA-6688-9rhm-gjv2 | Unreachable: the app never uses IN_PLACE, setConfig, SAFE_FOR_TEMPLATES, or CUSTOM_ELEMENT_HANDLING — every call is string-in/string-out | Re-vendor DOMPurify 3.4.16 at the next vendor sync |
| 4 | LOW | KaTeX 0.17.0 is in range of GHSA-238p-pmpm-9mq7 (read-side prototype-pollution `trust` hijack, fixed 0.18.2) | `resources/vendor/katex/katex.min.js`; `src/renderer/markdown/trusted.js:106` | Mitigated in-app: `trust: false` is an explicit own property (inherited-property bypass defeated) + `sanitizeMath` output re-sanitization; would also need an unrelated pollution gadget | Move to KaTeX ≥ 0.18.2 at the next vendor sync |
| 5 | INFO | `redirect: 'error'` is decorative — `pinnedGithubFetch` ignores the option; safety holds because Node `https.request` never follows redirects | `src/main/github-tls.js:88-96` | None (outcome equivalent: 3xx → `{error:'http'}`) | Drop the option or honor it |
| 6 | INFO | The PDF print window's CSP is content-supplied (export.js injects it into honest builds); the window enforces no session-level CSP | `src/renderer/markdown/export.js:23,158` vs `src/main/ipc-controller.js:798-833` | None — the load-bearing controls are the exact-match request allow-list + `javascript:false` + sandbox, which hold | Optionally add session-level `onHeadersReceived` CSP |
| 7 | INFO | XML-invalid control characters survive into EPUB OPF/XHTML → non-well-formed book | `src/renderer/markdown/epub.js:55-64` | Validity only — strict readers/epubcheck reject the export | Strip XML-invalid code points in `escapeXmlText` |
| 8 | INFO | An oversized `export:pdf` string is structured-cloned into main before the 10 MB cap rejects it | `src/main/ipc-controller.js:778-784` | Memory cost bounded by renderer, rejected before any use | Accepted IPC-inherent cost; no action |
| 9 | INFO | 5 stale unmerged dependabot branches on the remote, all superseded by `package.json` overrides | `git branch -r` | None — inert | Delete at the owner's discretion (no push per repo policy) |
| 10 | INFO | `claude.yml` grants a comment-triggered bot contents/PR/issues write on the public remote | `.github/workflows/claude.yml:41-45` | Inert: repo Actions are disabled and never triggered; grant is in-file documented and requires the repo secret to function | Posture note only |
| 11 | INFO | lucide-static 1.25.0 has a manifest `sources` entry but no hashed `assets` entry (icons are inlined into index.html) | `resources/vendor/vendor-manifest.json` | None — nothing to verify for it today | Note for the next manifest schema revision |
| 12 | INFO | Untracked local `LICENSE-AUDIT.md` still self-identifies as auditing `1.3.1` | `LICENSE-AUDIT.md:13` | None — untracked scratch, not distributed | Cosmetic; update on next license audit |

### Disposition — all four LOW findings fixed the same day, before release

| # | Fix |
|---|---|
| 1 | `pinnedGithubFetch` caps the buffered body at 1 MiB (`MAX_RESPONSE_BYTES`) and destroys the response the moment the cap is exceeded (`response-too-large`) |
| 2 | Every check path (manual channel, auto timer, boot check) funnels through a 60-second cooldown: a repeat inside the window returns the previous result without a second request; `network`/`unsupported` outcomes are never cached, so an offline user's retry really retries |
| 3 | Vendored DOMPurify 3.4.13 → 3.4.16 (latest 3.4.x) — outside both IN_PLACE advisory ranges |
| 4 | Vendored KaTeX 0.17.0 → 0.18.9 (latest) — outside the GHSA-238p-pmpm-9mq7 range; fonts, license texts, and manifest hashes re-synced (`vendor:check` green) |

Verification after the fixes: full suite green (2151 unit + 852 e2e + 28 electron),
`lint:security` green at 222 exact findings, refreshed SBOM/OSV scans clean (grype:
7-Zip accepted risk only), release preflight green, and all three Windows installers
rebuilt with `package:verify` re-attested.

## Accepted risk — carried forward (rechecked this audit)

**7-Zip 16.04/20.02 inside `electron-winstaller` — still open, still non-exposed.** The
refreshed grype database now lists the 2025–2026 CVE wave against the same binaries in
addition to the 44 known at triage (e.g. High: CVE-2026-14266, CVE-2026-48092/48095,
CVE-2026-48103/48111, CVE-2025-53816/53817; Medium: CVE-2026-48101/48102/48104/48112,
CVE-2026-58052, CVE-2024-11612; Low: CVE-2025-55188). All 45 grype rows are this one
component; nothing else in the SBOM breaches the threshold. Upstream is unchanged
(`electron-winstaller` 5.4.4, last published 2026-07-01 — same binaries as the 5.4.0
previously tested via `npm overrides`). The rationale is unchanged: this project builds
`nsis` + `portable` only, the Squirrel lane never executes, the binaries are not
git-tracked, and `scripts/verify-package-contents.js` now *gates* their absence from every
shipped tree. The risk closes when upstream embeds 7-Zip ≥ 24.09. Neither `npm audit` nor
osv-scanner can see this class (vendored binaries inside a package).

```
grype dir:node_modules/electron-winstaller --fail-on high   # recheck command
```

## Hostile review — hypotheses attacked and disproven

| Surface | Hypothesis | Why it fails |
|---|---|---|
| D1 IPC/capabilities | Forge/guess a capability id; replay a persisted grant without session authority; symlink/rename TOCTOU; write-conflict bypass; reopen extension bypass; snapshot poisoning | Ids are `cap-` + UUID (unguessable) and regex-validated; persisted records are inert without a session grant; every fs call re-realpaths + re-checks containment + symlink escape; write requires a main-computed hash; reopen re-pins extension + containment; registry load re-validates records structurally (SEC-05) and the S-M1 persist/session lane split is present |
| D2 `app://` `bpmd://` | `..`/%-encode/backslash traversal; symlink escape; MIME confusion; `frame-ancestors` bypass; closed-vault replay; `app://` prefix escape | vaultId is split from the raw URL pre-decode; containment checked on resolve AND on realpathed canonical paths (SEC-08); bpmd MIME allow-list is images-only (no HTML/SVG); the CSP header gate is exact-MIME equality; bpmd roots must be *currently open* vaults re-checked per request; every miss → 404, never throws |
| D3 XSS (27 `innerHTML` sites) | Break out via marked custom extensions (wikilink/highlight/sub/sup/footnotes), DOMPurify config, KaTeX, mermaid, Trusted Types default policy | Nearly all hits are `= ''` clears; every content sink is `escapeHtml`'d, catalog-static, numeric, or `parseMarkdown` output (DOMPurify, FORBID style/on* + custom URI regexp + data:-on-navigators hook); wikilink attributes cannot be terminated (quotes stripped) and aliases are escaped (SEC-11); footnote ids are position numbers, not user text; `annotation-xml` forbidden; `trust` cannot be re-enabled via overrides; the TT `createScriptURL` guard rejects backslash/NUL/`://` and post-prefix `..`, fail-closed |
| D4 Navigation/external open | Scheme-gate bypass via crafted hrefs or menu descriptors | `classifyNavigation` allows only exact `appUrl` equality; external requires `^(https?\|mailto\|tel):`; everything else (file:, data:, javascript:, bpmd:, custom) blocked; menu descriptors pass the same gate main-side; `update:release-page` opens a fixed module literal and takes no argument |
| D5 Update check | Response fields flowing into dangerous sinks; prototype pollution; pin rollback; verify-script drift | Only `tag_name`/`version` are read and must pass strict SemVer or the check errors; `data` is never merged/spread; release-page URL is not renderer-influenceable; pins checked fail-closed pre-body on the whole presented chain; `verify-tls-pin.js` imports the runtime's own `DEFAULT_CERT_PINS` (no copy to drift) — see LOW #1/#2 for the residual gaps |
| D6 PDF/EPUB export | 10 MB cap bypass; partition escape; temp race; zip-slip; looser re-sanitize; XML injection; renderer path injection | Cap is main-side on the single IPC string (no streaming channel exists); partition allow-list is exact-match on the registered temp URL and the renderer never learns the UUID; `'wx'` exclusive create fails closed on a planted file; EPUB entry names are fixed literals with a loop counter (no user string, no read-back path); chapters reuse the exact preview sanitize config + XML escaping + `on*` stripping; output path is main-dialog-only with `basename`-crushed default |
| D7 Electron config | Weak window preferences; fuses drift; permission/webview holes | Main window: `contextIsolation`+`sandbox`+`webSecurity`, no node, no webview, no sub-frame node, DevTools off when packaged; PDF window stricter still (`javascript:false`, no preload); permissions deny-all except fullscreen; `will-attach-webview` preventDefault; package:verify reads 7 fuses from all 3 built binaries |
| D8 Vendored libraries | Known CVE in a vendored lib that osv cannot see | Manifest versions match the bytes in every version-bearing file; mermaid 11.16.1 is exactly the patched release for the full 2026 batch; marked 18.0.6 and highlight.js 11.11.1 have no affecting advisories; DOMPurify/KaTeX ranges covered in LOW #3/#4 with in-app mitigations verified by grep, not by trust |
| D9 Data at rest | Log/channel leakage contradicting PRIVACY.md | `log:error` is rate-limited, local-only, message+stack only; crash reporter is `uploadToServer: false, submitURL: ''`; stores hold what PRIVACY.md says (opaque ids, paths only, positions only); the drive-letter-share limitation is honestly documented |
| E Release gates | Trick the preflight/checksums/package gates with a hostile `dist/` layout | `verifyChecksums` recomputes every hash and requires the manifest to be byte-canonical against the exact 12-artifact allowlist (both directions); package:verify reads the built asars and enforces installer-tooling absence as a gate; preflight enforces scan-freshness vs the lockfile (GATE-02) and exactly one changelog section; the Inno lane is fail-closed (pinned ISCC by path+SHA256+Authenticode, nonce staging from a hash-verified manifest, `/DVerifiedStaging=1` mandatory, post-move hash + signature re-assert) |

## Coverage caveats

- The pinned-TLS assumption in LOW #1/#2 cuts both ways: the update flow's attack surface
  is GitHub (or the two SPKI keys), not the local network — but a compromise of that pair
  is the design's trusted root, by construction.
- semgrep respects `.gitignore`; scanner coverage of `node_modules` comes from osv (816
  packages), npm audit, grype (SBOM), and the SHA-256 vendor manifest (`vendor:check`),
  not from scanning those trees as first-party code.
- grype's 7-Zip matches are binary-version detections inside one never-shipped vendor
  directory; they are counted in the accepted-risk section, not as app findings.
- The two DOMPurify advisories and the KaTeX advisory were published 2026-09-21/23 —
  *after* the 2026-09-26 scan; this audit is their first triage for this app.
