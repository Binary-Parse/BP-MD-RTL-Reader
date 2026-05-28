# Marqam Test Suite v2.0 Report

Generated: 2026-05-27

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Test Files | 35 |
| Total Tests | ~520 |
| Unit Tests | 121 |
| E2E Tests | ~400 |
| Unit Test Pass Rate | 100% (121/121) |
| E2E Test Pass Rate | 100% (~400/400) |
| Mutation Score | **98.80%** |
| Combined Code Coverage | **55.12% lines, 77.88% branches** |

---

## 1. Unit Tests (Vitest)

**Runner:** Vitest v4.1.7 (Node environment)

**Files:**

| File | Tests | Description |
|------|-------|-------------|
| `tests/unit/arabic.test.js` | 12 | `isArabicHeavy()` — Unicode Arabic detection |
| `tests/unit/tags.test.js` | 9 | Tag extraction from markdown |
| `tests/unit/toc.test.js` | 9 | Heading extraction & slug generation |
| `tests/unit/markdown.test.js` | 14 | Wikilink tokenizer/renderer, escapeHtml |
| `tests/unit/search.test.js` | 11 | `vaultSearch()` — vault-wide search |
| `tests/unit/state.test.js` | 11 | Proxy State store, cycleTheme, zoom clamp |
| `tests/unit/theme.test.js` | 7 | Theme cycling, FOUC prevention |
| `tests/unit/main-logic.test.js` | 48 | **Pure logic extracted from main.js** |

**Result:** ✅ 121 passed, 0 failed

### 1.1 Extracted Testable Module

`src/main-logic.js` was extracted from `main.js` to make security and business logic testable:

- `parseFileArg(argv, fs)` — command-line file parsing
- `isAuthorizedPath(path, allowedFolders)` — JB1 allowlist
- `isNetworkPath(path)` — JB2 UNC rejection
- `isTooManyFiles(count)` — JB3 file count cap
- `isOversizedFile(size)` — JB3 per-file size cap
- `wouldExceedCumulative(bytes, fileSize)` — JB3 cumulative cap
- `isSymlinkEscape(realPath, folderPath, path)` — JB4 symlink escape
- `stripBOM(content)` — BOM stripping
- `filterAndSortMdFiles(entries)` — markdown file filtering

---

## 2. E2E Tests (Playwright)

**Runner:** Playwright v1.59.1 (Chromium, headless, 1440×900)

### 2.1 Original Test Suite (~400 tests)

All existing tests continue to pass after refactoring:

| Category | Files | Key Coverage |
|----------|-------|--------------|
| Baseline | `baseline.spec.js` | Visual baselines |
| Bug Fixes | `bug-fixes-7bugs.spec.js` | AC1-AC8 acceptance criteria |
| Adversarial | `adversarial-9bugs.spec.js` | XSS, injection, boundary |
| RTL | `rtl-fixes.spec.js`, `rtl-heading-fix.spec.js` | RTL layout, computed styles |
| Security | `ipc-security.spec.js` | JB1-JB4 security checks |
| Visual | `visual.spec.js` | Screenshot regression |

### 2.2 New v2.0 Test Suites (47 tests)

| File | Tests | Layer |
|------|-------|-------|
| `tests/accessibility.spec.js` | 10 | A11y (axe-core WCAG 2.1 AA) |
| `tests/fuzz.spec.js` | 8 | Fuzzing (1000+ iterations) |
| `tests/i18n.spec.js` | 11 | I18N & localization |
| `tests/performance.spec.js` | 5 | Performance budgets |
| `tests/property-based.spec.js` | 13 | Property-based invariants |

---

## 3. Mutation Testing (StrykerJS)

**Target:** `src/main-logic.js`
**Mutants Generated:** 83
**Score:** **98.80%** ✅

| Status | Count |
|--------|-------|
| Killed | 81 |
| Timed out | 1 |
| Survived | 1 |
| No coverage | 0 |
| Errors | 0 |

### Survived Mutant (1) — Equivalent Mutant

| Mutator | Line | Replacement | Note |
|---------|------|-------------|------|
| BlockStatement | 29 | `catch (_) {}` | Semantically equivalent to `continue` inside a `for` loop. Both fall through to the next iteration. Cannot be killed without code restructuring. |

**Report:** `reports/mutation/mutation.html`

---

## 4. Code Coverage

### 4.1 Main Process (Node/Vitest)

| File | Stmts | Branch | Funcs | Lines |
|------|-------|--------|-------|-------|
| `src/main-logic.js` | **100%** | **100%** | **100%** | **100%** |
| `main.js` | 0% | 0% | 0% | 0% |
| `preload.js` | 0% | 100% | 0% | 0% |

**Report:** `coverage/node/index.html`

`main.js` and `preload.js` show 0% because they require the Electron runtime which cannot be instrumented in Node.js. Their security logic is extracted into `src/main-logic.js` at 100% coverage.

### 4.2 Renderer (Playwright/V8)

| File | Stmts | Branch | Funcs | Lines |
|------|-------|--------|-------|-------|
| `marqam.html` | **57.78%** | **97.88%** | **35.43%** | **57.63%** |

**Report:** `coverage/renderer-report/index.html`

Excellent branch coverage (97.88%) indicates the e2e tests exercise nearly all conditional paths. Low function coverage (35.43%) is expected for inline HTML — many event handlers and callbacks are only triggered by specific user interactions not exercised in the collector.

### 4.3 Combined Coverage

| Metric | Value |
|--------|-------|
| Statements | 54.84% (1047/1909) |
| Branches | 77.88% (250/321) |
| Functions | 34.96% (57/163) |
| Lines | 55.12% (1028/1865) |

**Report:** `coverage/merged/index.html`

---

## 5. How to Run

```bash
# Unit tests
npm run test:unit

# Unit tests with coverage
npm run test:unit:coverage

# E2E tests
npm run test:e2e

# E2E tests with renderer coverage
npm run test:e2e:coverage

# Mutation testing
npm run test:mutation

# Full coverage (unit + renderer)
npm run coverage

# Merge reports
npm run report:merge
```

---

## 6. Artifacts

| Artifact | Location |
|----------|----------|
| Unit coverage (HTML) | `coverage/node/index.html` |
| Renderer coverage (HTML) | `coverage/renderer-report/index.html` |
| Merged coverage (HTML) | `coverage/merged/index.html` |
| Mutation report (HTML) | `reports/mutation/mutation.html` |
| Mutation report (JSON) | `reports/mutation/mutation.json` |
| Unit coverage (JSON) | `coverage/node/coverage-final.json` |
| Renderer coverage (JSON) | `coverage/renderer-report/coverage-final.json` |
| Merged coverage (JSON) | `coverage/merged/coverage-final.json` |
| Renderer raw V8 coverage | `coverage/renderer/*.json` |

---

## 7. Known Limitations

1. **main.js/preload.js coverage**: Requires Electron runtime. Security logic is extracted to `src/main-logic.js` (100% covered). Integration tests in `ipc-security.spec.js` cover the IPC handlers via black-box testing.

2. **Renderer function coverage**: Inline event handlers in `marqam.html` are not instrumented as named functions by V8, leading to low function coverage despite high branch coverage.

3. **Mutation testing scope**: Currently only `src/main-logic.js` is mutated. Renderer code in `marqam.html` would require extraction to a module for Stryker support.

4. **Full suite runtime**: ~5 minutes with 1 worker. CI should shard or increase workers.
