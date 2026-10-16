/**
 * large-file-renderer.test.js — the renderer side of large notes: tier maths, the numbers it
 * shares with main, how a huge note is treated by the word count and the vault search.
 */
import { describe, test, expect, afterEach } from 'vitest';
import {
  MIB, TIER, DEFAULT_LIMITS, applyLimits, resetLimits, getLimits, noteTier, megabytes, limitMb,
  inLargeMode, skipsEditPreview, needsRenderPrompt, isLargeExport, exportFailureKind,
  renderSlice, RENDER_ANYWAY_CHARS, openTier, hasLongLine, MAX_WRAP_LINE_CHARS,
} from '../../src/renderer/components/large-file.js';
import { bodyWordCount, SAMPLE_ABOVE } from '../../src/renderer/components/doc-meta.js';
import { vaultSearch } from '../../src/renderer/components/search.js';

afterEach(() => resetLimits());

describe('noteTier: every edge, exactly at and one byte over', () => {
  test.each([
    [0, TIER.NORMAL], [5 * MIB, TIER.NORMAL], [5 * MIB + 1, TIER.LARGE],
    [20 * MIB, TIER.LARGE], [20 * MIB + 1, TIER.HUGE],
    [100 * MIB, TIER.HUGE], [100 * MIB + 1, TIER.REFUSED],
  ])('%i bytes -> tier %i', (bytes, tier) => {
    expect(noteTier(bytes)).toBe(tier);
  });

  test('garbage sizes are treated as an ordinary note', () => {
    for (const bad of [undefined, null, NaN, -1, '5', Infinity]) expect(noteTier(bad)).toBe(TIER.NORMAL);
  });
});

describe('limits from main', () => {
  test('applyLimits takes positive numbers and ignores the rest', () => {
    applyLimits({ maxFileBytes: 7 * MIB, confirmNoteBytes: -1, largeNoteBytes: 'x', maxEpubBytes: NaN });
    expect(getLimits().maxFileBytes).toBe(7 * MIB);
    expect(getLimits().confirmNoteBytes).toBe(DEFAULT_LIMITS.confirmNoteBytes);
    expect(getLimits().largeNoteBytes).toBe(DEFAULT_LIMITS.largeNoteBytes);
    expect(noteTier(7 * MIB + 1)).toBe(TIER.REFUSED);
  });

  test('a missing or odd answer keeps the defaults', () => {
    for (const bad of [undefined, null, 'str', 5]) applyLimits(bad);
    expect(getLimits()).toEqual(DEFAULT_LIMITS);
  });
});

describe('modes and messages', () => {
  test('inLargeMode / skipsEditPreview / needsRenderPrompt follow the tier', () => {
    const normal = { largeTier: TIER.NORMAL };
    const large = { largeTier: TIER.LARGE };
    const huge = { largeTier: TIER.HUGE };
    expect([inLargeMode(normal), inLargeMode(large), inLargeMode(huge), inLargeMode(null)]).toEqual([false, false, true, false]);
    expect([skipsEditPreview(normal), skipsEditPreview(large), skipsEditPreview(huge)]).toEqual([false, true, true]);
    expect(needsRenderPrompt(huge)).toBe(true);
    expect(needsRenderPrompt({ ...huge, renderAnyway: true })).toBe(false);
    expect(needsRenderPrompt(large)).toBe(false);
  });

  test('megabytes and limitMb', () => {
    expect(megabytes(5.5 * MIB)).toBe('5.5');
    expect(megabytes(21 * MIB)).toBe('21');
    expect(megabytes(0)).toBe('0');
    expect(limitMb(100 * MIB)).toBe('100');
  });

  test('a large export is announced above 5 MiB, not at it', () => {
    expect(isLargeExport(5 * MIB)).toBe(false);
    expect(isLargeExport(5 * MIB + 1)).toBe(true);
  });

  test('export error codes map to three kinds', () => {
    expect(exportFailureKind({ error: 'too-large' })).toBe('too-large');
    expect(exportFailureKind({ error: 'timeout' })).toBe('timeout');
    for (const code of ['export-failed', 'write-failed', 'weird']) expect(exportFailureKind({ error: code })).toBe('failed');
    expect(exportFailureKind(null)).toBe('failed');
  });
});

describe('Render anyway shows a bounded slice', () => {
  const huge = { largeTier: TIER.HUGE };
  test('a note in large-file mode within the cap renders whole', () => {
    expect(renderSlice(huge, 'a\nb')).toEqual({ body: 'a\nb', cut: false });
  });
  test('past the cap it is cut at a line end and flagged', () => {
    const line = `${'x'.repeat(99)}\n`;
    const text = line.repeat(RENDER_ANYWAY_CHARS / 100 + 50);
    const out = renderSlice(huge, text);
    expect(out.cut).toBe(true);
    expect(out.body.length).toBeLessThanOrEqual(RENDER_ANYWAY_CHARS);
    expect(out.body.endsWith('x')).toBe(true); // a whole line, not half of one
  });
  test('an ordinary note is never cut', () => {
    expect(renderSlice({ largeTier: TIER.LARGE }, 'x'.repeat(RENDER_ANYWAY_CHARS + 10)).cut).toBe(false);
  });
});

describe('word count of a huge note', () => {
  test('exact up to the sampling size', () => {
    expect(bodyWordCount('one two three')).toBe(3);
  });
  test('estimated above it, from slices, in the right order of magnitude', () => {
    const words = 'alpha beta gamma delta '.repeat(Math.ceil((SAMPLE_ABOVE * 3) / 23));
    const real = words.trim().split(/\s+/).length;
    const est = bodyWordCount(words);
    expect(est).toBeGreaterThan(real * 0.9);
    expect(est).toBeLessThan(real * 1.1);
  });
});

describe('vault search over a note in large-file mode', () => {
  const body = `${'filler line\n'.repeat(50)}the needle is here\n${'more filler\n'.repeat(50)}`;
  test('finds a literal match', () => {
    const file = { name: 'huge.md', content: body, largeTier: TIER.HUGE };
    const out = vaultSearch('needle', [file]);
    expect(out).toHaveLength(1);
    expect(out[0].hits[0].match).toBe('needle');
  });
  test('is case-sensitive there (documented trade-off)', () => {
    const file = { name: 'huge.md', content: body, largeTier: TIER.HUGE };
    expect(vaultSearch('NEEDLE', [file])).toEqual([]);
    expect(vaultSearch('NEEDLE', [{ ...file, largeTier: TIER.NORMAL }])).toHaveLength(1);
  });
});

describe('openTier', () => {
  test('is the tier of an open note: never past HUGE, whatever the size', () => {
    expect([openTier(MIB), openTier(6 * MIB), openTier(30 * MIB), openTier(100 * MIB + 1), openTier(10 ** 12)])
      .toEqual([TIER.NORMAL, TIER.LARGE, TIER.HUGE, TIER.HUGE, TIER.HUGE]);
  });
});

describe('hasLongLine', () => {
  const filler = `${'a'.repeat(40)}\n`;

  test('a text no longer than the limit has no long line, whatever its lines', () => {
    expect(hasLongLine('x'.repeat(100), 100)).toBe(false);
    expect(hasLongLine('', 10)).toBe(false);
  });

  test('finds a line past the limit anywhere in a longer text', () => {
    expect(hasLongLine(filler.repeat(5) + 'b'.repeat(51), 50)).toBe(true);
    expect(hasLongLine('c'.repeat(51) + filler.repeat(5), 50)).toBe(true);
    expect(hasLongLine(`${filler.repeat(5)}${'b'.repeat(51)}\n${filler}`, 50)).toBe(true);
  });

  test('a line of exactly the limit is not long; many short lines are not long however many there are', () => {
    expect(hasLongLine(`${'a'.repeat(50)}\n${'b'.repeat(50)}`, 50)).toBe(false);
    expect(hasLongLine('abc\n'.repeat(1000), 50)).toBe(false);
  });

  test('the default limit is below the length at which CodeMirror failed (15 M characters)', () => {
    expect(MAX_WRAP_LINE_CHARS).toBeLessThan(14_000_000);
    expect(hasLongLine('x'.repeat(MAX_WRAP_LINE_CHARS + 1))).toBe(true);
    expect(hasLongLine('x'.repeat(MAX_WRAP_LINE_CHARS))).toBe(false);
  });
});
