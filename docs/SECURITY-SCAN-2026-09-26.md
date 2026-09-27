# Security Scan — 2026-09-26

Local-only security pipeline (Local Security Pipeline v1.0), run in WSL2 Ubuntu against
HEAD `4b037b0` with the then-pending working tree (52 paths). Approved scanners only:
gitleaks, trufflehog, semgrep, syft, grype, osv-scanner, checkov. Raw artifacts are kept
under the gitignored `.secreports/2026-09-26/` (this file records the durable outcome).
Refreshed 2026-09-27 for the 1.3.0 preflight: the root-level `sbom.json` and
`osv-scanner.txt` artifacts were re-run against the bumped lockfile — OSV clean again,
816 packages, 0 vulnerabilities (the 2026-09-26 subdir artifacts are unchanged).
A hostile audit of the release tree — fresh scans plus an adversarial boundary review —
followed the same day: `docs/SECURITY-AUDIT-2026-09-27.md`.

## Verdict

**FINDINGS — 1 accepted risk, 0 unresolved true-positives.** No secrets, no app-code
vulnerabilities, no CI configuration violations.

| Check | Status | Count |
|---|---|---|
| gitleaks — full git history, all refs | CLEAN | 101 commits, 0 leaks |
| gitleaks — working tree (incl. ignored) | CLEAN | 325 MB, 0 leaks |
| trufflehog — live-credential verification | CLEAN | 0 verified hits |
| semgrep (auto + p/secrets) | CLEAN after triage | 35 raw, all false-positives |
| syft SBOM | CLEAN | 1059 components |
| grype (`--fail-on high`) | 1 finding | see accepted risk below |
| osv-scanner (`--recursive --no-ignore`) | CLEAN | 816 lockfile packages, 0 vulns |
| checkov (github_actions) | CLEAN | 388 passed, 0 failed |
| CI workflow audit (4 workflows) | CLEAN | SHA-pinned, least-privilege, no banned tools |

## Manual review — 7 vulnerability classes

All seven classes attested against the code (evidence at file:line in
`.secreports/2026-09-26/REPORT.md`):

1. **Authorization/IDOR (IPC)** — VERIFIED-SAFE: opaque capability ids; the renderer never
   holds filesystem paths; every fs channel re-authorizes per call.
2. **Row-level security** — N-A (no database backend anywhere).
3. **SQL** — N-A (no query layer; JSON-file stores only).
4. **SSRF** — VERIFIED-SAFE: sole egress is the SPKI-pinned `api.github.com` fetch;
   `shell.openExternal` is scheme-gated; the PDF-export session blocks everything except
   `data:`/`about:`/its own temp file.
5. **Output encoding** — VERIFIED-SAFE: every `innerHTML` sink is escaped or
   DOMPurify-sanitized, behind CSP `require-trusted-types-for 'script'` plus a
   sanitizing default Trusted Types policy.
6. **Crypto** — VERIFIED-SAFE: SHA-256 only; authority ids from `crypto.randomUUID`; the
   one `Math.random` use is a non-security highlight id.
7. **Path traversal** — VERIFIED-SAFE: realpath-then-contain on every fs/protocol path;
   atomic `O_EXCL` temp writes; UNC paths rejected; moved-document re-pins re-validated.

## Accepted risk — 7-Zip inside electron-winstaller (MEDIUM)

`electron-winstaller@5.4.0` (peer of `electron-builder-squirrel-windows`, pulled in by
`electron-builder`) bundles 7-Zip 16.04/20.02 binaries in
`node_modules/electron-winstaller/vendor/` — 44 CVEs, including CVE-2025-0411
(High, KEV-listed, EPSS 67%). Triaged **MEDIUM**, then **accepted**, because:

- This project builds `nsis` + `portable` targets only (`build.win.target`); the Squirrel
  lane never runs, so the binaries never execute here.
- Nothing 7-Zip-related is git-tracked or shipped; end users never receive these files.
- A bump to the latest upstream 5.4.4 was tested (npm `overrides`) and **rejected**: 5.4.4
  bundles the identical 16.04/20.02 binaries, so the override was reverted.

**Recheck on future releases:**

```
grype dir:node_modules/electron-winstaller --fail-on high
```

The risk closes itself out when an upstream release embeds 7-Zip ≥ 24.09. Note that
neither `npm audit` nor osv-scanner can see this class of issue: they match package
versions, not vendored binaries inside packages.

## Scan-coverage caveats

- semgrep exits 0 even with findings unless `--error` is passed; classification must read
  the SARIF, not the exit code. grype 0.118 signals a threshold breach with exit code 2.
- osv-scanner reports "0 packages" for `resources/vendor/` (single-file minified libs
  carry no manifests); coverage comes from the same library versions in the scanned
  lockfile plus the SHA-256 vendor manifest (`npm run vendor:check`).
- This run refreshes the stale grype/osv/semgrep artifacts flagged as GATE-02 in
  `docs/AUDIT-REPORT-2026-09-26.md`.
