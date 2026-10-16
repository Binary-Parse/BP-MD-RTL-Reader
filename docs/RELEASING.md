# Releasing

How a maintainer builds and publishes a release.
For how to build the installers, see [Build from source](BUILD.md).

GitHub Actions is disabled on this repository, and there is no release pipeline.
Releases are built and published by hand, so every gate a pipeline would enforce is your job.

## Contents

- [What a release contains](#what-a-release-contains)
- [Release checklist](#release-checklist)
- [What the preflight checks](#what-the-preflight-checks)
- [Rotate the TLS pins](#rotate-the-tls-pins)
- [Signing](#signing)
- [Tag and publish](#tag-and-publish)
- [Release commits and local main](#release-commits-and-local-main)

## What a release contains

### Public artifact contract

Version 2.1.0 publishes exactly these 8 files, plus the generated checksum manifest:

```text
BP-MD-RTL-Reader-2.1.0-Windows-NSIS-multiarch.exe
BP-MD-RTL-Reader-2.1.0-Windows-Portable-multiarch.exe
BP-MD-RTL-Reader-2.1.0-Windows-Inno-x64.exe
BP-MD-RTL-Reader-2.1.0-Windows-Inno-x64.source-manifest.json
BP-MD-RTL-Reader-2.1.0-Linux-x86_64.AppImage
BP-MD-RTL-Reader-2.1.0-Linux-arm64.AppImage
BP-MD-RTL-Reader-2.1.0-Linux-amd64.deb
BP-MD-RTL-Reader-2.1.0-Linux-arm64.deb
```

The allowlist lives in `scripts/release-artifacts.js`.
The `multiarch` Windows installers (NSIS and portable) each contain x64 and ARM64 builds.
32-bit Windows (`ia32`) is not built, because Electron 44 publishes no `win32-ia32` binary.

**macOS is not built and not tested.**
The `mac` block in `package.json` is kept as a starting point only.
There is no Mac to build on, no Apple Developer certificate, and `build/icons/icon.png` (256 px) is too small for a macOS icon.
Do not attach a macOS file to a release until it has been built, signed, notarized, and tested on a Mac.

**The release is not code-signed** (owner decision, 2026-10-10).
The [README](../README.md#download) tells users how to check a download against `SHA256SUMS.txt` and what the SmartScreen warning means.

There is no updater.
`"publish": null` keeps electron-builder from writing `app-update.yml` and `latest*.yml`.
`resources/elevate.exe` still ships in the NSIS build, because electron-builder packs it into every per-machine installation and ignores `packElevateHelper: false` there. It is listed in `THIRD-PARTY-NOTICES.md`.
`appImage.executableArgs: []` removes the `--no-sandbox` that electron-builder otherwise puts in the AppImage's desktop entry.

## Release checklist

Run these in order. The build steps need Windows for the first two and Linux or WSL 2 for the third.

```bash
npm test                              # unit, browser e2e, Electron boundary
npm run lint:security                 # SAST against the reviewed baseline
npm run lint:tests                    # undefined and unused names in tests
npm run dupcheck                      # duplicate code, fails above 1 %
npm run vendor:check                  # vendored assets match their manifest
npm run license:inventory             # dependency-license summary is current
npm run tls:verify                    # TLS pins against the LIVE api.github.com chain
npm run audit:deps                    # every npm advisory fixed or reviewed
npm run scan:deps                     # syft SBOM and osv-scanner report, recorded with
                                      # the SHA-256 of package-lock.json
npm run dist                          # Windows NSIS and portable installers
pwsh -File build/installer/build-installer.ps1   # Inno x64 installer
npm run dist:linux                    # on Linux or WSL: AppImage and deb, x64 and ARM64
npm run package:verify                # archive contents and Electron fuses
                                      # (with no dist/ it FAILS unless
                                      # VERIFY_FUSES_ALLOW_NO_BINARIES=1)
```

Then copy the 8 files into `dist/release` and finish:

```bash
npm run package:checksums             # rejects missing, extra, duplicate, or case-colliding
                                      # names, then writes SHA256SUMS.txt
npm run package:checksums:verify      # rechecks the allowlist and every hash
node scripts/release-preflight.js     # version, changelog, scans, and the artifact set
```

Do not invent placeholders for a file this machine cannot build.
Leave the checksum file out until the full set exists.

Before you assemble `dist/release`, you can run the preflight early with `--skip-artifact-check`.
If the dependency scans are stale and you accept that, pass `--skip-sbom-staleness` and say so in the release notes.

## What the preflight checks

`scripts/release-preflight.js` fails the release when:

- `package.json` does not hold a stable SemVer version.
- The repository slug (`GITHUB_REPOSITORY`, or `package.json` when it is unset) is not `Binary-Parse/BP-MD-RTL-Reader`.
- `CHANGELOG.md` does not hold exactly one non-empty section for that version.
- The SBOM and OSV reports are missing, were made from another `package-lock.json`, were changed after the scan, or name an advisory that is not reviewed in `config/audit-acceptance.json` (`--skip-sbom-staleness` skips this).
- `dist/release` is missing, differs from the allowlist, or has checksums that do not match the bytes (`--skip-artifact-check` skips this).

`package:verify` reads the fuse wire out of each packaged binary instead of trusting configuration.
`tls:verify` exists because the 1.3.0-rc pin shipped unverified and matched no live certificate.
Never skip it: a pin that looks right but matches nothing silently kills the update check, which then fails closed.

## Rotate the TLS pins

The update check accepts GitHub's answer only over a certificate chain that contains a pinned public key.
The pin list in `src/main/github-tls.js` holds the four keys of the chain GitHub presents (leaf to root) and six backup roots of other certificate authorities.
`npm run tls:verify` prints each presented key as `LIVE` or `BACKUP`:

| Result | Meaning | What to do |
| ------ | ------- | ---------- |
| Exit 1, nothing matched | The update check would fail on every install | Do not release. Re-mint `LIVE_CHAIN_PINS` from the live chain |
| Warning: the leaf pin no longer matches | GitHub re-issued its leaf with a new key (it expires 2026-11-27 at the latest) | The CA pins still carry the check. Replace the leaf pin |
| Warning: only backup roots match | GitHub changed its certificate authority | Replace all four live pins |

A root pin must be the public key of the root it names in Node's bundled root store. `tests/unit/github-tls.test.js` fails otherwise.
An installed copy whose pins match nothing tells the user that the check was not made, and offers the Releases page.

## Signing

Releases are published unsigned (see [What a release contains](#what-a-release-contains)).
The signing support in the build is kept for the day a certificate exists.
With `WIN_CSC_LINK` (the path to a PFX) and `WIN_CSC_KEY_PASSWORD` set, `npm run dist` signs the Windows files.

A release build of the Inno installer is fail-closed.
It needs a Binary Parse code-signing certificate already imported into `Cert:\CurrentUser\My`, a trusted Windows SDK `signtool.exe`, and the same two variables:

```powershell
$env:WIN_CSC_LINK = 'C:\secure\binary-parse-code-signing.pfx'
$env:WIN_CSC_KEY_PASSWORD = '<secret>'
pwsh -File build/installer/build-installer.ps1 -RequireSigned `
  -CertificateSha1 '<40-hex-thumbprint>' `
  -SignToolPath 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe'
```

The script verifies the signer, the exact certificate thumbprint, and the timestamp on the application payload and on the generated installer.
The release VM gate separately verifies the installed uninstaller.
Neither path silently downgrades a requested signed build to unsigned output.

## Tag and publish

Tag the release once the artifacts verify:

```bash
git tag -a v2.1.0 -m "BP MD RTL Reader 2.1.0"
git push origin v2.1.0
```

Then create a GitHub Release by hand and attach `SHA256SUMS.txt` and all 8 allowlisted files.
Use the changelog section of the version as the release notes.

## Release commits and local main

Releases since 1.3.0 are published as one squashed commit per version on the remote `main` (1.3.0, 2.0.0).
The granular history stays local, so local `main` cannot fast-forward onto the remote.
Build the release commit from the release tree (`git commit-tree` on `main^{tree}`) and push it with its tag, or publish the notes with `gh release create`.
