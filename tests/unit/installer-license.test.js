/**
 * installer-license.test.js — T11/T12: the NSIS license page must survive
 * electron-builder's raw pass-through AND render its Arabic correctly.
 *
 * Facts these contracts pin (see the mojibake report + the RTF decision):
 *  - electron-builder emits `!insertmacro MUI_PAGE_LICENSE "<file>"` RAW when
 *    `nsis.license` is set explicitly (its BOM/CRLF converter only covers
 *    auto-discovered license files), so the file's own encoding is the contract.
 *  - NSIS renders a `.rtf` license natively — the redesign uses plain ASCII RTF
 *    with every Arabic character as a \uN? escape, so no ANSI codepage can ever
 *    corrupt it, and \rtlpar gives the Arabic section its right-to-left layout.
 *  - package.json must point at the RTF (electron-builder's extension whitelist
 *    accepts rtf/txt/html; txt-with-BOM was the previous, fragile contract).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const LICENSE = path.join(ROOT, 'build', 'installer', 'LICENSE-INSTALLER.rtf');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

describe('installer license encoding contracts (T11/T12)', () => {
  test('package.json points the NSIS build at the RTF license', () => {
    expect(PKG.build.nsis.license).toBe('installer/LICENSE-INSTALLER.rtf');
    expect(fs.existsSync(LICENSE)).toBe(true);
  });

  test('the license file is well-formed RTF (brace-balanced, single root group)', () => {
    const text = fs.readFileSync(LICENSE, 'utf8');
    expect(text.startsWith('{\\rtf1')).toBe(true);
    expect(text.trimEnd().endsWith('}')).toBe(true);
    const opens = (text.match(/\{/g) || []).length;
    const closes = (text.match(/\}/g) || []).length;
    expect(opens, 'brace balance').toBe(closes);
  });

  test('every byte is ASCII — the Arabic rides in \\uN? escapes, beyond codepage reach', () => {
    const bytes = fs.readFileSync(LICENSE);
    let nonAscii = 0;
    for (const b of bytes) {
      if (b > 0x7f) nonAscii += 1;
    }
    expect(nonAscii, 'non-ASCII byte count').toBe(0);
    const text = bytes.toString('utf8');
    expect(text).toMatch(/\\u\d+\?/); // escaped non-ASCII present…
    expect(text).toContain('\\rtlpar'); // …as right-to-left paragraphs…
    expect((text.match(/\\rtlpar/g) || []).length).toBeGreaterThanOrEqual(2); // heading + body
  });

  test('both language sections and the binding-order statement are present', () => {
    const text = fs.readFileSync(LICENSE, 'utf8');
    expect(text).toContain('MIT License');
    expect(text).toContain('Binary Parse');
    expect(text).toContain('binding');
    // The Arabic body is escaped, so assert on a distinctive escaped fragment:
    // the heading's first word 'رخصة' renders as \u1585?\u1582?\u1589?\u1577?.
    expect(text).toContain('\\u1585?\\u1582?\\u1589?\\u1577?');
  });

  test('every line ending is CRLF — pinned in .gitattributes (*.rtf eol=crlf)', () => {
    // T14: the T11 "CRLF contract" was asserted nowhere and the committed blob was LF-only,
    // so a fresh clone produced a different file than the machine that built 1.3.0. The
    // attribute now forces CRLF on checkout; this test fails if that ever regresses.
    const bytes = fs.readFileSync(LICENSE);
    const text = bytes.toString('latin1');
    expect((text.match(/\r\n/g) || []).length).toBeGreaterThan(0);
    expect((text.match(/(?<!\r)\n/g) || []).length, 'bare LF count').toBe(0);
  });
});
