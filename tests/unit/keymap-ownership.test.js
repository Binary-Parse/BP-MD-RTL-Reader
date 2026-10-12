import { describe, it, expect } from 'vitest';
import { APP_OWNED_KEYS, withoutAppOwnedKeys } from '../../src/renderer/editor/keymap-ownership.js';
import { shortcutLetter, hitKey, hitCode } from '../../src/renderer/shortcut-keys.js';

describe('keymap-ownership (audit H2 / H3)', () => {
  it('the app owns exactly Ctrl/Cmd+I and Ctrl/Cmd+/', () => {
    expect([...APP_OWNED_KEYS]).toEqual(['Mod-i', 'Mod-/']);
  });

  it('removes the Mod-i and Mod-/ bindings and keeps every other binding in order', () => {
    const a = { key: 'Mod-a', run: () => 1 };
    const i = { key: 'Mod-i', run: () => 2 };
    const slash = { key: 'Mod-/', run: () => 3 };
    const b = { key: 'Mod-[', run: () => 4 };
    expect(withoutAppOwnedKeys([a, i, b, slash])).toEqual([a, b]);
    expect(withoutAppOwnedKeys([a, i, b, slash])[0]).toBe(a);
  });

  it('keeps look-alike chords the app does not own', () => {
    const keep = [
      { key: 'Shift-Mod-i' }, { key: 'Mod-I' }, { key: 'Alt-i' }, { key: 'Mod-\\' },
      { key: 'Shift-Mod-/' }, { key: 'Mod-i-x' }, { key: 'Mod-Enter' },
    ];
    expect(withoutAppOwnedKeys(keep)).toEqual(keep);
  });

  it('keeps bindings that have no key (platform-only entries) and tolerates holes', () => {
    const mac = { mac: 'Ctrl-d', run: () => 1 };
    expect(withoutAppOwnedKeys([mac, null, undefined])).toEqual([mac, null, undefined]);
  });

  it('returns an empty array for a missing keymap and does not mutate its input', () => {
    expect(withoutAppOwnedKeys(undefined)).toEqual([]);
    expect(withoutAppOwnedKeys(null)).toEqual([]);
    const input = [{ key: 'Mod-i' }, { key: 'Mod-z' }];
    withoutAppOwnedKeys(input);
    expect(input).toHaveLength(2);
  });
});

describe('shortcut-keys (audit M24): a shortcut is the key label, on every layout', () => {
  const press = (key, code) => ({ key, code });

  it('US layout: letter and digit keys', () => {
    expect(shortcutLetter(press('s', 'KeyS'))).toBe('s');
    expect(shortcutLetter(press('S', 'KeyS'))).toBe('s'); // Shift or Caps Lock
    expect(shortcutLetter(press('3', 'Digit3'))).toBe('3');
    expect(shortcutLetter(press('!', 'Digit1'))).toBe('1'); // Shift+1 is still the 1 key
  });

  it('German layout: the key labelled Z is Undo, never Redo', () => {
    const z = press('z', 'KeyY');
    expect(hitKey(z, 'z')).toBe(true);
    expect(hitKey(z, 'y')).toBe(false);
    expect(hitKey(press('y', 'KeyZ'), 'y')).toBe(true);
  });

  it('French layout: Ctrl+Z does not close the tab, Ctrl+Q does not select all', () => {
    expect(hitKey(press('z', 'KeyW'), 'w')).toBe(false);
    expect(hitKey(press('w', 'KeyZ'), 'w')).toBe(true);
    expect(hitKey(press('q', 'KeyA'), 'a')).toBe(false);
    expect(hitKey(press('a', 'KeyQ'), 'a')).toBe(true);
    expect(shortcutLetter(press('&', 'Digit1'))).toBe('1'); // unshifted digit row
  });

  it('Arabic layout: the physical key decides', () => {
    expect(hitKey(press('س', 'KeyS'), 's')).toBe(true);
    expect(hitKey(press('ض', 'KeyQ'), 'q')).toBe(true);
    expect(shortcutLetter(press('١', 'Digit1'))).toBe('1');
  });

  it('a key that is no letter or digit matches nothing', () => {
    expect(shortcutLetter(press('Escape', 'Escape'))).toBe('escape');
    expect(shortcutLetter(press('', ''))).toBe('');
    expect(shortcutLetter({})).toBe('');
    expect(shortcutLetter(null)).toBe('');
    expect(hitKey(press('F11', 'F11'), 'f')).toBe(false);
  });

  it('punctuation: the produced character wins over the physical key', () => {
    expect(hitCode(press('/', 'Slash'), '/', 'Slash')).toBe(true);
    // German: '-' sits on the US Slash key. It is zoom out, not the shortcut sheet.
    const germanMinus = press('-', 'Slash');
    expect(hitCode(germanMinus, '/', 'Slash')).toBe(false);
    expect(hitCode(germanMinus, '-', 'Minus')).toBe(true);
    // French: 'm' sits on the US Semicolon key and ',' on the US KeyM.
    expect(hitCode(press(',', 'KeyM'), ',', 'Comma')).toBe(true);
    expect(hitCode(press('m', 'Comma'), ',', 'Comma')).toBe(false);
  });

  it('punctuation: a layout without the character falls back to the physical key', () => {
    expect(hitCode(press('ظ', 'Slash'), '/', 'Slash')).toBe(true);
    expect(hitCode(press('?', 'Slash'), '/', 'Slash')).toBe(true); // Shift+/
    expect(hitCode(press('ظ', 'Slash'), '-', 'Minus')).toBe(false);
    expect(hitCode({}, '/', 'Slash')).toBe(false);
    expect(hitCode(null, '/', 'Slash')).toBe(false);
  });
});
