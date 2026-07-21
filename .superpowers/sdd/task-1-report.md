# Task 1 — Persisted reader preferences and native zoom bridge

## Scope delivered

- Upgraded persistent settings from schema version 2 to 3.
- Added validated reader preference defaults and migration:
  - `readerTextScale`: 0.8–2.0, nearest 0.1, default 1.
  - `readerWidthCh`: 48–120, nearest 2ch, default 72.
- Persisted and restored the preferences through `setReaderTextScale` and
  `setReaderWidthCh` controller actions.
- Exposed `electronAPI.setAppZoom(factor)` through the isolated preload bridge.
  It accepts finite numeric input only, clamps to 0.6–2.0, calls
  `webFrame.setZoomFactor`, returns the applied factor, and uses no IPC.

## TDD evidence

### RED

Focused tests were added before production changes in:

- `tests/unit/settings.test.js`
- `tests/unit/settings-controller.test.js`
- `tests/unit/main-settings-ipc.test.js`

The corrected focused RED command was:

```powershell
npx vitest run --config vitest.config.js tests/unit/settings.test.js tests/unit/settings-controller.test.js tests/unit/main-settings-ipc.test.js
```

It collected 70 tests and failed 12 expected assertions: missing v3 defaults,
migration and clamp helpers, missing controller persistence/restore wiring, and
the absent `setAppZoom` bridge. The managed sandbox first blocked Vite config
loading with `spawn EPERM`; the same command in the permitted context produced
the meaningful RED result above.

### GREEN

The same focused command passed: **3 files, 70 tests passed**.

## Final verification

```powershell
npm run test:unit
# 76 files passed; 1,317 tests passed

npm run lint:security
# Security lint gate passed: 169 exact reviewed findings; 0 new or moved findings

git diff --check
# no whitespace errors
```

## Changed files

- `src/main/settings.js`
- `src/renderer/settings-controller.js`
- `preload.js`
- `tests/unit/settings.test.js`
- `tests/unit/settings-controller.test.js`
- `tests/unit/main-settings-ipc.test.js`
- `.superpowers/sdd/task-1-report.md`

## Self-review

- Migration always stamps v3 and malformed preference values fall back safely.
- Step rounding occurs after clamping, preserving the documented endpoints.
- Controller restoration uses no-op injected actions when consumers omit the
  new handlers, preserving the existing injectable seam.
- Preload strictly rejects strings, `NaN`, and infinities; valid calls do not
  invoke an IPC channel.
- Renderer isolation and the strict CSP are unchanged.

## Concerns

No known implementation concern. This task intentionally provides persistence
and bridge foundations only; UI controls and `app.js` integration were outside
its assigned scope and were not changed.
