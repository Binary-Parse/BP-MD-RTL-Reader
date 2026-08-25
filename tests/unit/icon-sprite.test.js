/**
 * icon-sprite.test.js — the v10 redesign needs four icons the sprite does not carry
 * yet: a sepia-theme sun, a pencil for edit mode, and expand/shrink for fullscreen.
 * They must come through scripts/sync-vendor.js's iconMap + `npm run vendor:sync`,
 * not a hand-pasted <symbol> — the generator rewrites the whole sprite block and a
 * hand-authored addition there would be silently overwritten on the next sync.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');

describe('icon sprite carries the v10 redesign icons', () => {
  for (const id of ['ic-sun-medium', 'ic-pencil', 'ic-expand', 'ic-shrink']) {
    test(`defines <symbol id="${id}">`, () => {
      expect(html, `missing symbol ${id}`).toMatch(new RegExp(`<symbol id="${id}"`));
    });
  }
});
