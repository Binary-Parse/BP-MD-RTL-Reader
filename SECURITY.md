# Security Policy

BP MD RTL Reader is a local-first desktop app: no telemetry, no accounts, no automatic
network requests, and no renderer network access. The sole opt-in exception is
**Help → Check for Updates…**, which requests public release metadata from GitHub without
note content or identifiers and does not download an update. The boundaries that contain
an untrusted Markdown file are a sandboxed renderer, DOMPurify-sanitised output, and
capability-scoped folder reads.

## Supported versions

| Version | Supported |
| ------- | --------- |
| Latest `1.x` release | ✅ |
| Older releases | ❌ |

Security fixes land in the latest release. Please upgrade before reporting an issue you
hit on an older build.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting: go to the repository's **Security** tab and
click **“Report a vulnerability”** (GitHub Security Advisories). This opens a private report
visible only to the maintainers.

When you report, please include:

- a description of the issue and its impact,
- the version / commit you observed it on, and
- clear steps to reproduce (a sample `.md` file, if relevant).

We aim to acknowledge reports within a few days and will keep you updated as we
investigate. Thanks for helping keep **Binary Parse** users safe.
