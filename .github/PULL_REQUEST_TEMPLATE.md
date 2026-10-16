## Summary

<!-- What does this PR change, and why? -->

Closes #<!-- issue number, or delete this line -->

## Changes

-

## Verification

<!-- List the commands and manual checks you ran. GitHub Actions is off, so say what you ran. -->

-

## Screenshots (RTL and LTR)

<!-- For a visible change, add before and after in a right-to-left note and in a left-to-right note. Delete this section if nothing visible changed. -->

## Checklist

- [ ] I followed the [contributing guide](../CONTRIBUTING.md)
- [ ] `npm run lint:security` and `npm run lint:tests` pass
- [ ] `npm test` passes
- [ ] `npm run coverage` passes for source changes
- [ ] `npm run dupcheck`, `npm run vendor:check`, and `npm run license:inventory` pass
- [ ] Relevant focused Playwright lanes pass
- [ ] `npm run package:verify` passes when packaging or runtime asset paths changed
- [ ] This change does **not** weaken the CSP, DOMPurify config, or path-security guards
- [ ] Docs and/or `CHANGELOG.md` are updated when behavior or workflows changed
