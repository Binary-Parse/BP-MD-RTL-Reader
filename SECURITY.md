# Security policy

BP MD RTL Reader is a local-first desktop app. This page says how to report a vulnerability, what you can expect from us, and what the security boundaries of the app are.

## How to report a vulnerability

Use GitHub private vulnerability reporting.
Open the repository's **Security** tab and choose **Report a vulnerability**, or go straight to the [private report form](https://github.com/Binary-Parse/BP-MD-RTL-Reader/security/advisories/new).

> [!IMPORTANT]
> Do not open a public issue for a vulnerability. Public issues are for ordinary bugs.

Please include:

- A description of the issue and its impact.
- The app version, or the commit, where you saw it.
- Your operating system and package type (installer, portable, AppImage, or `.deb`).
- Clear steps to reproduce. Attach a sample `.md` file if the issue depends on one.

## What to expect

- We acknowledge a report within 7 days. This is a best-effort promise from a small team.
- We keep you updated while we investigate, and tell you when a fix is released.
- There is no bug bounty.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 2.1.x | Yes, security fixes land here |
| Older than 2.1 | No, please upgrade first |

## Security posture

What a release is and is not:

- **Not code-signed.** The Windows installers carry no Authenticode signature, and the Linux packages carry no signature either. Check a download against the `SHA256SUMS.txt` of its release before you run it. The commands are in the [README](README.md#verify-your-download).
- **Platforms.** Windows 10 and 11 and Linux (x64 tested; ARM64 built but not run). macOS is not built and not tested.
- **Update check.** It is off by default and never downloads or installs anything. When you turn it on, the app asks GitHub for public release metadata, sending no note content or identifiers. The answer is accepted only over a certificate chain that contains a pinned public key. Otherwise the app says the check was not made. See [PRIVACY.md](docs/PRIVACY.md) for when it runs.
- **No network for the renderer.** The page that shows your notes makes no network request.
- **Untrusted Markdown.** The boundaries around a hostile Markdown file are a sandboxed renderer, DOMPurify-sanitized output, and capability-scoped folder reads.
- **IPC.** Every message from the page to the main process must come from the app's own top frame (`app://ui`). Any other sender is refused and logged.
- **No debugger in a release.** A packaged build exits at once when started with `--remote-debugging-port`, `--remote-debugging-pipe`, or `--inspect`. Chromium reads these switches before the app's own code runs, so the port can be open for that moment. Someone who can start the app with their own arguments can already read your files. This removes the debugger, not that access.
- **Linux sandbox.** The `.deb` installs Chromium's sandbox helper and runs sandboxed. An AppImage cannot carry that helper. It runs sandboxed when the system allows unprivileged user namespaces. Otherwise its launcher starts the app with `--no-sandbox` so that it starts at all. Prefer the `.deb` where you can. On Ubuntu 24.04 and later, which restrict those namespaces by default, the `.deb` also installs the AppArmor profile the sandbox needs, and an AppImage cannot.

For how these pieces fit together, see [Architecture](docs/ARCHITECTURE.md#security-model).

## Scope

In scope:

- The app, its installers, and the files published on the Releases page.
- Escaping the renderer sandbox, bypassing sanitization, or reading files outside a folder you opened.
- Anything that makes the app contact the network when it should not.

Out of scope:

- Problems that need an attacker who can already run code as you, or who can start the app with their own arguments.
- The SmartScreen warning for unsigned installers. It is expected and documented.
- Vulnerabilities in a dependency with no way to reach them through the app. Report those to the dependency.

Thank you for helping keep **Binary Parse** users safe.
