# Security Policy

BP MD RTL Reader is a local-first desktop app: no telemetry, no accounts, no network
request you did not ask for, and no renderer network access. There are two opt-in
exceptions, and both do the same thing: **Help → Check for Updates…**, and the automatic
check in **Settings ▸ Updates**, which is off by default and runs at most once a day when
you turn it on. Each requests public release metadata from GitHub without note content or
identifiers and does not download an update. The answer is accepted only
over a certificate chain that contains a pinned public key; otherwise the app says that the
check was not made. The boundaries that contain
an untrusted Markdown file are a sandboxed renderer, DOMPurify-sanitised output, and
capability-scoped folder reads.

## What a release is, and is not

- **Not code-signed.** The Windows installers carry no Authenticode signature and the Linux
  packages no signature either. Check a download against the `SHA256SUMS.txt` of its release
  (commands in the README) before running it.
- **Platforms.** Windows 10/11 (x64, ARM64) and Linux (x64 tested; ARM64 built, not run).
  macOS is not built and not tested.
- **No automatic update.** The app never downloads or installs anything by itself.
- **Linux sandbox.** The `.deb` installs Chromium's sandbox helper and runs sandboxed. An
  AppImage cannot carry that helper: it runs sandboxed when the system allows unprivileged
  user namespaces, and otherwise its launcher starts the app with `--no-sandbox` so that it
  starts at all. Prefer the `.deb` where you can.

## Supported versions

| Version | Supported |
| ------- | --------- |
| Latest `2.x` release | ✅ |
| Older releases | ❌ |

Security fixes land in the latest release. Please upgrade before reporting an issue you
hit on an older build.

## Reporting a vulnerability

Report a security problem by opening an issue on GitHub. There is no private reporting
channel.

When you report, please include:

- a description of the issue and its impact,
- the version / commit you observed it on, and
- clear steps to reproduce (a sample `.md` file, if relevant).

We aim to acknowledge reports within a few days and will keep you updated as we
investigate. Thanks for helping keep **Binary Parse** users safe.
