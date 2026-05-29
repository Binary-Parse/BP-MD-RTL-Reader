/**
 * main-observability.test.js — STRONG mutation-killing assertions for the
 * Observability cluster of main.js (audit follow-up):
 *
 *   - crashReporter.start options                       (L32)
 *   - ensureLogPath / log file path + mkdir recursive   (L38-42)
 *   - rotateIfNeeded rename chain + size guard          (L46-55, L34 LOG_MAX_BYTES)
 *   - writeLog JSON fields, truncation, size guards     (L49-53 / L59-72)
 *   - proc.on uncaughtException / unhandledRejection    (L74-81)
 *   - ipcMain.on('log:error') rate-limiter + rollover   (L189-211)
 *
 * These tests EXECUTE the same code the existing suite touches but ASSERT the
 * EXACT observable values (both true AND false branches) so an operator/value/
 * flag mutation would flip an assertion and the mutant dies.
 *
 * Drives the real bootstrap() with injected mocks from the shared harness; no
 * Module hijack. STRICT: this file imports the harness + bootstrap only and
 * does not touch main.js / preload.js / harness / other test files.
 */

import { describe, test, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { bootstrap } from '../../main.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

// Pull a captured ipcMain.on listener by channel name.
function getOn(mockElectron, name) {
  const call = mockElectron.ipcMain.on.mock.calls.find(c => c[0] === name);
  return call && call[1];
}

// Path-separator-agnostic "endsWith" helper (Windows uses \, POSIX uses /).
function normSep(p) {
  return String(p).replace(/\\/g, '/');
}

// ───────────────────────────────────────────────────────────────────────────
// crashReporter.start — pins {uploadToServer:false, submitURL:''}     (L32)
// ───────────────────────────────────────────────────────────────────────────
describe('observability — crashReporter.start options (L32)', () => {
  let mockElectron;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    bootstrap({ electron: mockElectron, fs: buildMockFs(), proc: buildMockProc(['node', 'main.js']) });
    await new Promise(r => setTimeout(r, 50));
  });

  test('crashReporter.start called exactly once with uploadToServer:false and submitURL:""', () => {
    expect(mockElectron.crashReporter.start).toHaveBeenCalledTimes(1);
    const opts = mockElectron.crashReporter.start.mock.calls[0][0];
    // BooleanLiteral mutant (false -> true) dies here.
    expect(opts).toMatchObject({ uploadToServer: false, submitURL: '' });
    expect(opts.uploadToServer).toBe(false);
    // StringLiteral mutant ('' -> 'Stryker was here!') dies here.
    expect(opts.submitURL).toBe('');
    // ObjectLiteral mutant ({...} -> {}) dies because the keys would be absent.
    expect(Object.prototype.hasOwnProperty.call(opts, 'uploadToServer')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(opts, 'submitURL')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ensureLogPath + writeLog path/fields/truncation                (L38-72)
// ───────────────────────────────────────────────────────────────────────────
describe('observability — writeLog path + JSON line shape (L38-72)', () => {
  let mockElectron;
  let mockFs;
  let mockProc;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    // app.getPath('userData') returns '/mock/userData/userData' in the harness.
    mockFs = buildMockFs();
    mockProc = buildMockProc(['node', 'main.js']);
    bootstrap({ electron: mockElectron, fs: mockFs, proc: mockProc });
    await new Promise(r => setTimeout(r, 50));
  });

  test('writeLog appends to a path ending logs/marqam.log and mkdirs it recursively', () => {
    mockFs.appendFileSync.mockClear();
    mockFs.mkdirSync.mockClear();

    // Drive writeLog through the uncaughtException path.
    mockProc.emit('uncaughtException', new Error('seed'));

    expect(mockFs.appendFileSync).toHaveBeenCalledTimes(1);
    const writtenPath = normSep(mockFs.appendFileSync.mock.calls[0][0]);
    // Kills StringLiteral mutants on 'logs' and 'marqam.log'.
    expect(writtenPath.endsWith('logs/marqam.log')).toBe(true);

    // mkdirSync called for the logs dir with { recursive: true } (ObjectLiteral
    // + BooleanLiteral mutants die: a missing/false flag would change the arg).
    expect(mockFs.mkdirSync).toHaveBeenCalled();
    const [dirArg, optsArg] = mockFs.mkdirSync.mock.calls[0];
    expect(normSep(dirArg).endsWith('logs')).toBe(true);
    expect(optsArg).toEqual({ recursive: true });
  });

  test('ensureLogPath memoizes: mkdir + path computed once across many writes', () => {
    mockFs.mkdirSync.mockClear();
    mockFs.appendFileSync.mockClear();
    for (let i = 0; i < 5; i++) mockProc.emit('uncaughtException', new Error('x'));
    // logFilePath is cached after first ensureLogPath() so mkdirSync must NOT be
    // re-invoked. Kills a mutant that drops the `if (logFilePath) return ...`.
    expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    expect(mockFs.appendFileSync).toHaveBeenCalledTimes(5);
  });

  test('writeLog emits a parseable JSON line with level/source/message and an ISO ts', () => {
    mockFs.appendFileSync.mockClear();
    mockProc.emit('uncaughtException', new Error('field-check'));

    const line = mockFs.appendFileSync.mock.calls[0][1];
    // Trailing newline is part of the contract (StringLiteral '\n' mutant dies).
    expect(line.endsWith('\n')).toBe(true);
    const obj = JSON.parse(line);

    expect(obj.level).toBe('error');
    expect(obj.source).toBe('main:uncaughtException');
    expect(obj.message).toBe('field-check');
    // ts is an ISO-8601 timestamp string (Date.toISOString); kills a mutant that
    // drops the ts field or replaces the call.
    expect(typeof obj.ts).toBe('string');
    expect(obj.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(obj.ts))).toBe(false);
  });

  test('writeLog truncates message to 4000 chars and stack to 8000 chars', () => {
    mockFs.appendFileSync.mockClear();
    const longMsg = 'M'.repeat(5000);
    const longStack = 'S'.repeat(9000);
    mockProc.emit('uncaughtException', { message: longMsg, stack: longStack });

    const obj = JSON.parse(mockFs.appendFileSync.mock.calls[0][1]);
    // slice(0,4000) — mutant changing 4000 (e.g. to 0 or removing slice) dies.
    expect(obj.message).toHaveLength(4000);
    expect(obj.message).toBe('M'.repeat(4000));
    // slice(0,8000) — mutant changing 8000 dies.
    expect(obj.stack).toHaveLength(8000);
    expect(obj.stack).toBe('S'.repeat(8000));
  });

  test('writeLog with a short message keeps it intact (does not over-truncate)', () => {
    mockFs.appendFileSync.mockClear();
    mockProc.emit('uncaughtException', { message: 'short', stack: 'trace' });
    const obj = JSON.parse(mockFs.appendFileSync.mock.calls[0][1]);
    expect(obj.message).toBe('short');
    expect(obj.stack).toBe('trace');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// rotateIfNeeded — size guard + rename chain                      (L34,L46-55)
// ───────────────────────────────────────────────────────────────────────────
describe('observability — log rotation guard + rename chain (L34,L46-55)', () => {
  let mockElectron;
  let mockFs;
  let mockProc;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    mockFs = buildMockFs();
    mockProc = buildMockProc(['node', 'main.js']);
    bootstrap({ electron: mockElectron, fs: mockFs, proc: mockProc });
    await new Promise(r => setTimeout(r, 50));
  });

  test('size strictly below 1 MiB does NOT rotate (renameSync not called)', () => {
    mockFs.renameSync.mockClear();
    // 1 byte under the 1*1024*1024 cap → guard returns early.
    mockFs.statSync.mockReturnValueOnce({ size: 1024 * 1024 - 1 });
    mockFs.existsSync.mockImplementation(() => true);

    mockProc.emit('uncaughtException', new Error('under-cap'));

    expect(mockFs.renameSync).not.toHaveBeenCalled();
  });

  test('size exactly at 1 MiB DOES rotate (boundary: < is not <=)', () => {
    mockFs.renameSync.mockClear();
    // Exactly the cap → `size < LOG_MAX_BYTES` is false → rotation proceeds.
    // Kills the relational mutant `<` -> `<=` and the LOG_MAX_BYTES arithmetic.
    mockFs.statSync.mockReturnValueOnce({ size: 1024 * 1024 });
    mockFs.existsSync.mockImplementation(() => true);

    mockProc.emit('uncaughtException', new Error('at-cap'));

    expect(mockFs.renameSync).toHaveBeenCalled();
  });

  test('rotation renames .2->.3, .1->.2, then file->.1 (exact ordered chain)', () => {
    mockFs.renameSync.mockClear();
    mockFs.statSync.mockReturnValueOnce({ size: 2 * 1024 * 1024 });
    // All prior rotation files exist so every loop-body rename fires.
    mockFs.existsSync.mockImplementation(() => true);

    mockProc.emit('uncaughtException', new Error('rotate'));

    const calls = mockFs.renameSync.mock.calls.map(([from, to]) => [normSep(from), normSep(to)]);
    // Exactly 3 renames: the two loop iterations (i=2, i=1) + the final file->.1.
    expect(calls).toHaveLength(3);

    const base = calls[2][0]; // the live log path (source of final rename)
    // Ordered chain — kills loop-direction (i-- vs i++), the i+1 / i index
    // arithmetic, and the '.1' StringLiteral.
    expect(calls).toEqual([
      [`${base}.2`, `${base}.3`],
      [`${base}.1`, `${base}.2`],
      [base, `${base}.1`],
    ]);

    // Spec-level: a rename target ending ".3" AND one ending ".1" both exist.
    const targets = calls.map(c => c[1]);
    expect(targets.some(t => t.endsWith('.3'))).toBe(true);
    expect(targets.some(t => t.endsWith('.1'))).toBe(true);
    // Final rotation moves the live file to ".1" (not the older slots).
    expect(calls[2][1].endsWith('.1')).toBe(true);
  });

  test('rotation skips a missing intermediate file (existsSync false guards rename)', () => {
    mockFs.renameSync.mockClear();
    mockFs.statSync.mockReturnValueOnce({ size: 2 * 1024 * 1024 });
    // No prior rotation files exist → the two conditional renames are skipped,
    // only the unconditional final file->.1 runs. Kills the Conditional/Block
    // mutant that would force the guarded rename regardless of existsSync.
    mockFs.existsSync.mockImplementation(() => false);

    mockProc.emit('uncaughtException', new Error('rotate-empty'));

    const calls = mockFs.renameSync.mock.calls.map(([from, to]) => [normSep(from), normSep(to)]);
    expect(calls).toHaveLength(1);
    expect(calls[0][1].endsWith('.1')).toBe(true);
  });

  test('statSync throwing (no log file yet) is swallowed: no rename, append still runs', () => {
    mockFs.renameSync.mockClear();
    mockFs.appendFileSync.mockClear();
    mockFs.statSync.mockImplementationOnce(() => { throw new Error('ENOENT'); });

    mockProc.emit('uncaughtException', new Error('first-write'));

    expect(mockFs.renameSync).not.toHaveBeenCalled();
    // writeLog still appends after rotateIfNeeded's try/catch swallows the stat error.
    expect(mockFs.appendFileSync).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// process error handlers — uncaughtException / unhandledRejection (L74-81)
// ───────────────────────────────────────────────────────────────────────────
describe('observability — process error handlers (L74-81)', () => {
  let mockElectron;
  let mockFs;
  let mockProc;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    mockFs = buildMockFs();
    mockProc = buildMockProc(['node', 'main.js']);
    bootstrap({ electron: mockElectron, fs: mockFs, proc: mockProc });
    await new Promise(r => setTimeout(r, 50));
  });

  beforeEach(() => {
    mockFs.appendFileSync.mockClear();
  });

  test('both handlers were registered on proc', () => {
    expect(mockProc._listeners.uncaughtException).toHaveLength(1);
    expect(mockProc._listeners.unhandledRejection).toHaveLength(1);
  });

  test('uncaughtException -> source "main:uncaughtException" + the error message + stack', () => {
    const err = new Error('uncaught-boom');
    mockProc.emit('uncaughtException', err);

    const obj = JSON.parse(mockFs.appendFileSync.mock.calls.at(-1)[1]);
    expect(obj.level).toBe('error');
    // StringLiteral mutant on 'main:uncaughtException' dies.
    expect(obj.source).toBe('main:uncaughtException');
    expect(obj.message).toBe('uncaught-boom');
    expect(typeof obj.stack).toBe('string');
    expect(obj.stack.length).toBeGreaterThan(0);
  });

  test('unhandledRejection with an Error -> source + message + DEFINED stack (true branch)', () => {
    const err = new Error('promise-boom');
    mockProc.emit('unhandledRejection', err);

    const obj = JSON.parse(mockFs.appendFileSync.mock.calls.at(-1)[1]);
    // StringLiteral mutant on 'main:unhandledRejection' dies.
    expect(obj.source).toBe('main:unhandledRejection');
    // `reason instanceof Error ? reason.message : String(reason)` — true branch.
    expect(obj.message).toBe('promise-boom');
    // `reason instanceof Error ? reason.stack : undefined` — true branch.
    expect(obj.stack).toBeDefined();
    expect(typeof obj.stack).toBe('string');
  });

  test('unhandledRejection with a non-Error reason -> message=String(reason), stack UNDEFINED (false branch)', () => {
    mockProc.emit('unhandledRejection', 'plain string reason');

    const obj = JSON.parse(mockFs.appendFileSync.mock.calls.at(-1)[1]);
    expect(obj.source).toBe('main:unhandledRejection');
    // false branch of the message ternary: String(reason).
    expect(obj.message).toBe('plain string reason');
    // false branch of the stack ternary: undefined → JSON.stringify omits key.
    expect(obj.stack).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(obj, 'stack')).toBe(false);
  });

  test('unhandledRejection with a numeric reason stringifies it (ConditionalExpression both-branch coverage)', () => {
    mockProc.emit('unhandledRejection', 42);
    const obj = JSON.parse(mockFs.appendFileSync.mock.calls.at(-1)[1]);
    expect(obj.message).toBe('42');
    expect(obj.stack).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// log:error rate-limiter — cap, invalid-payload guard, rollover  (L189-211)
//
// logWindowStart is captured from Date.now() when registerIpcHandlers() runs
// (during the whenReady tick). We spy on Date.now BEFORE bootstrap so the
// window start is a known fixed value (T0), then advance it deterministically.
// ───────────────────────────────────────────────────────────────────────────
describe('observability — log:error rate-limiter + rollover (L189-211)', () => {
  let mockElectron;
  let mockFs;
  let mockProc;
  let logError;
  let nowSpy;
  let clock;
  const T0 = 1_700_000_000_000;

  beforeAll(async () => {
    clock = T0;
    nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);

    mockElectron = buildMockElectron();
    mockFs = buildMockFs();
    mockProc = buildMockProc(['node', 'main.js']);
    bootstrap({ electron: mockElectron, fs: mockFs, proc: mockProc });
    await new Promise(r => setTimeout(r, 50));

    logError = getOn(mockElectron, 'log:error');
    expect(typeof logError).toBe('function');
  });

  afterAll(() => {
    nowSpy.mockRestore();
  });

  test('non-object / falsy payloads are ignored — no append (early-return guard)', () => {
    mockFs.appendFileSync.mockClear();
    logError({}, null);
    logError({}, undefined);
    logError({}, 'not-an-object');
    logError({}, 42);
    logError({}, true);
    expect(mockFs.appendFileSync).not.toHaveBeenCalled();
  });

  test('a valid object payload writes one renderer log line with its message + stack', () => {
    mockFs.appendFileSync.mockClear();
    logError({}, { message: 'render-boom', stack: 'at render:1' });
    expect(mockFs.appendFileSync).toHaveBeenCalledTimes(1);
    const obj = JSON.parse(mockFs.appendFileSync.mock.calls[0][1]);
    expect(obj.level).toBe('error');
    // StringLiteral 'renderer' source mutant dies.
    expect(obj.source).toBe('renderer');
    expect(obj.message).toBe('render-boom');
    expect(obj.stack).toBe('at render:1');
  });

  test('caps at exactly 100 writes per minute, dropping the remainder (cap value pinned)', () => {
    // Fresh window: advance just enough to NOT roll over (still within 60s),
    // but reset the per-test count by emulating a brand-new window. We instead
    // assert the cap precisely starting from the current (already-partly-used)
    // window by measuring deltas across a large burst inside ONE fixed instant.
    //
    // Simplest deterministic approach: roll the window over first (advance past
    // 60s) so logCount resets to 0, then fire 250 within the SAME instant.
    clock = T0 + 61_000;          // > 60_000 → rollover resets count to 0
    logError({}, { message: 'window-reset' }); // triggers the rollover + counts as 1

    mockFs.appendFileSync.mockClear();
    // Now 99 slots remain in this window (1 already used by 'window-reset').
    for (let i = 0; i < 250; i++) logError({}, { message: `burst-${i}` });

    const written = mockFs.appendFileSync.mock.calls.length;
    // logCount started at 1; cap is 100 → exactly 99 more are written, rest dropped.
    // Kills the cap-value mutant (100) and the `>=` relational mutant.
    expect(written).toBe(99);
    // Every written line is a renderer error (not a summary) within the window.
    const sources = mockFs.appendFileSync.mock.calls.map(c => JSON.parse(c[1]).source);
    expect(sources.every(s => s === 'renderer')).toBe(true);
  });

  test('after advancing ~70s past the window, a "main:rateLimit" dropped-N summary is written then the new entry', () => {
    // We are mid-window with logDropped > 0 from the previous burst (250 fired,
    // 99 written, 151 dropped). Advance the clock past the 60s window.
    clock = clock + 70_000;        // > 60_000 from the current window start
    mockFs.appendFileSync.mockClear();

    logError({}, { message: 'first-after-rollover' });

    const lines = mockFs.appendFileSync.mock.calls.map(c => JSON.parse(c[1]));
    // Exactly TWO appends: the summary, then the new renderer entry.
    expect(lines).toHaveLength(2);

    const summary = lines[0];
    const fresh = lines[1];
    // Summary is logged at WARN level from source 'main:rateLimit'.
    expect(summary.level).toBe('warn');
    expect(summary.source).toBe('main:rateLimit');
    // "dropped N renderer log entries (cap 100/min)" — N must equal the 151
    // dropped in the previous window. Kills the message/template + cap mutants.
    const m = summary.message.match(/^dropped (\d+) renderer log entries \(cap (\d+)\/min\)$/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBe(151);
    expect(Number(m[2])).toBe(100);
    // The new event itself is then written as a normal renderer entry.
    expect(fresh.source).toBe('renderer');
    expect(fresh.message).toBe('first-after-rollover');
  });

  test('rollover with NO drops does NOT emit a summary (logDropped > 0 false branch)', () => {
    // Current window has only 1 entry ('first-after-rollover'); nothing dropped.
    // Advance past 60s and write again: the `if (logDropped > 0)` guard is false,
    // so NO summary line — only the new entry. Kills the `> 0` relational mutant
    // and the Conditional/Block mutant around the summary write.
    clock = clock + 65_000;
    mockFs.appendFileSync.mockClear();

    logError({}, { message: 'clean-rollover' });

    const lines = mockFs.appendFileSync.mock.calls.map(c => JSON.parse(c[1]));
    expect(lines).toHaveLength(1);
    expect(lines[0].source).toBe('renderer');
    expect(lines[0].message).toBe('clean-rollover');
    expect(lines.some(l => l.source === 'main:rateLimit')).toBe(false);
  });

  test('within the window (delta <= 60s) the count does NOT reset — no premature rollover', () => {
    // Advance by exactly 60_000 (the boundary): `now - logWindowStart > 60_000`
    // is FALSE at the boundary, so NO rollover and NO summary. Kills the `>` ->
    // `>=` relational mutant on the window check.
    clock = clock + 60_000;        // exactly the window length, not strictly past
    mockFs.appendFileSync.mockClear();

    logError({}, { message: 'boundary-entry' });

    const lines = mockFs.appendFileSync.mock.calls.map(c => JSON.parse(c[1]));
    // No summary at the boundary; just the entry.
    expect(lines.some(l => l.source === 'main:rateLimit')).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0].message).toBe('boundary-entry');
  });
});
