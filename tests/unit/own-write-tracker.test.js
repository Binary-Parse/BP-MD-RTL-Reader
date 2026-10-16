/**
 * own-write-tracker.test.js — H15 step 2.
 *
 * DATA-INTEGRITY RULE: an external edit must NEVER be hidden. The tracker may only call a
 * file event "ours" when the file's content RIGHT NOW is byte-for-byte (hash) the content
 * the app itself wrote, within a short window. Timestamps alone never decide anything.
 *
 * Expected values come from that requirement, not from the implementation.
 */
import { describe, test, expect, vi } from 'vitest';
import path from 'node:path';
import { createOwnWriteTracker } from '../../src/main/own-write-tracker.js';

function make(opts = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const tracker = createOwnWriteTracker({ now: clock.now, path: path.posix, platform: 'linux', ...opts });
  return { tracker, clock };
}

describe('createOwnWriteTracker — what counts as our own write', () => {
  test('the content we wrote, seen again within the window, is ours', () => {
    const { tracker } = make();
    tracker.record('/v/a.md', 'hash-A');
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-A')).toBe(true);
  });

  test('DIFFERENT content on disk (an external edit) is never ours', () => {
    const { tracker } = make();
    tracker.record('/v/a.md', 'hash-A');
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-B')).toBe(false);
  });

  test('a path we never wrote is not ours, and its content is not even read', () => {
    const { tracker } = make();
    tracker.record('/v/a.md', 'hash-A');
    const read = vi.fn(() => 'hash-A');
    expect(tracker.isOwnWrite('/v/other.md', read)).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  test('every event of the same save is suppressed, not just the first', () => {
    const { tracker } = make();
    tracker.record('/v/a.md', 'hash-A');
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-A')).toBe(true);
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-A')).toBe(true);
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-A')).toBe(true);
  });

  test('once the disk has moved away from our write the record is gone: a later revert is reported', () => {
    const { tracker } = make();
    tracker.record('/v/a.md', 'hash-A');
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-B')).toBe(false);  // external edit seen
    // the file is then changed BACK to the bytes we once wrote: the renderer holds B now,
    // so this is a real change and must be reported
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-A')).toBe(false);
  });

  test('a newer write replaces the older one: only the latest content is ours', () => {
    const { tracker } = make();
    tracker.record('/v/a.md', 'hash-1');
    tracker.record('/v/a.md', 'hash-2');
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-1')).toBe(false);
  });

  test('the newest write is still ours after it replaced an older one', () => {
    const { tracker } = make();
    tracker.record('/v/a.md', 'hash-1');
    tracker.record('/v/a.md', 'hash-2');
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-2')).toBe(true);
  });

  test('files are tracked independently', () => {
    const { tracker } = make();
    tracker.record('/v/a.md', 'hash-A');
    tracker.record('/v/b.md', 'hash-B');
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-A')).toBe(true);
    expect(tracker.isOwnWrite('/v/b.md', () => 'hash-X')).toBe(false); // b was edited externally
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-A')).toBe(true);  // a is unaffected by b
  });
});

describe('createOwnWriteTracker — safe failure modes (never hide a change)', () => {
  test('an unreadable file (hash null) is not ours', () => {
    const { tracker } = make();
    tracker.record('/v/a.md', 'hash-A');
    expect(tracker.isOwnWrite('/v/a.md', () => null)).toBe(false);
  });

  test('a throwing hash reader is not ours and does not throw', () => {
    const { tracker } = make();
    tracker.record('/v/a.md', 'hash-A');
    expect(tracker.isOwnWrite('/v/a.md', () => { throw new Error('EBUSY'); })).toBe(false);
  });

  test('an unreadable file clears the record (it cannot be trusted afterwards)', () => {
    const { tracker } = make();
    tracker.record('/v/a.md', 'hash-A');
    tracker.isOwnWrite('/v/a.md', () => null);
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-A')).toBe(false);
  });

  test.each([['empty', ''], ['null', null], ['number', 42], ['undefined', undefined]])('a %s hash is never recorded', (_label, bad) => {
    const { tracker } = make();
    tracker.record('/v/a.md', bad);
    expect(tracker.isOwnWrite('/v/a.md', () => bad)).toBe(false);
  });

  test.each([['null', null], ['number', 7], ['undefined', undefined]])('a %s path is never recorded and does not throw', (_label, bad) => {
    const { tracker } = make();
    expect(() => tracker.record(bad, 'hash-A')).not.toThrow();
    expect(tracker.isOwnWrite(bad, () => 'hash-A')).toBe(false);
  });

  test('an empty path is never recorded (it would otherwise alias the working directory)', () => {
    const { tracker } = make();
    tracker.record('', 'hash-A');
    expect(tracker.isOwnWrite(path.posix.resolve(''), () => 'hash-A')).toBe(false);
  });

  test('a non-function reader is not ours', () => {
    const { tracker } = make();
    tracker.record('/v/a.md', 'hash-A');
    expect(tracker.isOwnWrite('/v/a.md', undefined)).toBe(false);
  });
});

describe('createOwnWriteTracker — time window', () => {
  test('default window is 10 s: ours up to and including 10 s after the write', () => {
    const { tracker, clock } = make();
    tracker.record('/v/a.md', 'hash-A');
    clock.advance(10_000);
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-A')).toBe(true);
  });

  test('one millisecond past the window the same bytes are reported', () => {
    const { tracker, clock } = make();
    tracker.record('/v/a.md', 'hash-A');
    clock.advance(10_001);
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-A')).toBe(false);
  });

  test('an expired record does not read the file at all', () => {
    const { tracker, clock } = make();
    tracker.record('/v/a.md', 'hash-A');
    clock.advance(60_000);
    const read = vi.fn(() => 'hash-A');
    tracker.isOwnWrite('/v/a.md', read);
    expect(read).not.toHaveBeenCalled();
  });

  test('the window is measured from the LATEST write', () => {
    const { tracker, clock } = make();
    tracker.record('/v/a.md', 'hash-1');
    clock.advance(8_000);
    tracker.record('/v/a.md', 'hash-2');
    clock.advance(8_000); // 16 s after the first write, 8 s after the second
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-2')).toBe(true);
  });

  test('the window is configurable', () => {
    const { tracker, clock } = make({ ttlMs: 500 });
    tracker.record('/v/a.md', 'hash-A');
    clock.advance(500);
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-A')).toBe(true);
    clock.advance(1);
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-A')).toBe(false);
  });

  test('uses the real clock when none is injected', () => {
    vi.useFakeTimers();
    try {
      const tracker = createOwnWriteTracker({ path: path.posix, platform: 'linux' });
      tracker.record('/v/a.md', 'hash-A');
      vi.advanceTimersByTime(9_999);
      expect(tracker.isOwnWrite('/v/a.md', () => 'hash-A')).toBe(true);
      vi.advanceTimersByTime(2);
      expect(tracker.isOwnWrite('/v/a.md', () => 'hash-A')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createOwnWriteTracker — bounded memory', () => {
  test('keeps at most maxEntries files, forgetting the oldest first', () => {
    const { tracker } = make({ maxEntries: 3 });
    for (const n of ['a', 'b', 'c', 'd']) tracker.record(`/v/${n}.md`, `hash-${n}`);
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-a')).toBe(false); // evicted
    expect(tracker.isOwnWrite('/v/b.md', () => 'hash-b')).toBe(true);
    expect(tracker.isOwnWrite('/v/c.md', () => 'hash-c')).toBe(true);
    expect(tracker.isOwnWrite('/v/d.md', () => 'hash-d')).toBe(true);
  });

  test('re-recording a file refreshes its position (it is not the oldest any more)', () => {
    const { tracker } = make({ maxEntries: 2 });
    tracker.record('/v/a.md', 'hash-a');
    tracker.record('/v/b.md', 'hash-b');
    tracker.record('/v/a.md', 'hash-a2'); // a is now the newest
    tracker.record('/v/c.md', 'hash-c');  // evicts b, not a
    expect(tracker.isOwnWrite('/v/b.md', () => 'hash-b')).toBe(false);
    expect(tracker.isOwnWrite('/v/a.md', () => 'hash-a2')).toBe(true);
  });

  test('expired records are dropped when a new one is added', () => {
    const { tracker, clock } = make({ maxEntries: 2 });
    tracker.record('/v/a.md', 'hash-a');
    tracker.record('/v/b.md', 'hash-b');
    clock.advance(20_000);
    tracker.record('/v/c.md', 'hash-c');
    tracker.record('/v/d.md', 'hash-d');
    expect(tracker.isOwnWrite('/v/c.md', () => 'hash-c')).toBe(true);
    expect(tracker.isOwnWrite('/v/d.md', () => 'hash-d')).toBe(true);
  });
});

describe('createOwnWriteTracker — path identity', () => {
  test('different spellings of the same path (. and .. segments) are the same file', () => {
    const { tracker } = make();
    tracker.record('/v/sub/../a.md', 'hash-A');
    expect(tracker.isOwnWrite('/v/./a.md', () => 'hash-A')).toBe(true);
  });

  test('POSIX paths are case-sensitive: A.md is not a.md', () => {
    const { tracker } = make();
    tracker.record('/v/a.md', 'hash-A');
    expect(tracker.isOwnWrite('/v/A.md', () => 'hash-A')).toBe(false);
  });

  test('Windows paths are case-insensitive', () => {
    const tracker = createOwnWriteTracker({ now: () => 1, path: path.win32, platform: 'win32' });
    tracker.record('C:\\Vault\\Note.md', 'hash-A');
    expect(tracker.isOwnWrite('c:\\vault\\NOTE.md', () => 'hash-A')).toBe(true);
  });

  // QA-L4: macOS reports a name decomposed (NFD) that the app wrote precomposed (NFC); it is
  // one file there. On Linux and Windows the two forms are two files.
  test('macOS treats the NFC and NFD form of a name as one file; Linux and Windows do not', () => {
    const nfc = '/v/caf\u00e9.md';
    const nfd = '/v/cafe\u0301.md';
    const mac = createOwnWriteTracker({ now: () => 1, path: path.posix, platform: 'darwin' });
    mac.record(nfc, 'hash-A');
    expect(mac.isOwnWrite(nfd, () => 'hash-A')).toBe(true);
    const { tracker: linux } = make();
    linux.record(nfc, 'hash-A');
    expect(linux.isOwnWrite(nfd, () => 'hash-A')).toBe(false);
    const win = createOwnWriteTracker({ now: () => 1, path: path.win32, platform: 'win32' });
    win.record('C:\\v\\caf\u00e9.md', 'hash-A');
    expect(win.isOwnWrite('C:\\v\\cafe\u0301.md', () => 'hash-A')).toBe(false);
  });
});
