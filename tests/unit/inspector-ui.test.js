// @vitest-environment jsdom
import { describe, test, expect } from 'vitest';
import {
  docTitle, encodingLabel, eolLabel, inspectorData, renderInspectorDoc, renderInspectorProgress, zoomLabel, renderZoom,
} from '../../src/renderer/components/inspector-ui.js';

describe('docTitle', () => {
  test('is the first level-one heading', () => {
    expect(docTitle('# Reading as a Craft\n\nBody', 'x.md')).toBe('Reading as a Craft');
  });

  test('skips front matter and strips emphasis marks and closing hashes', () => {
    expect(docTitle('---\ntitle: Other\n---\n# **Bold** `code` title ##\n', 'x.md')).toBe('Bold code title');
  });

  test('ignores a hash line inside a fenced code block', () => {
    expect(docTitle('```bash\n# not a title\n```\n\n# Real title', 'x.md')).toBe('Real title');
  });

  test('falls back to the file name without its extension', () => {
    expect(docTitle('no heading here', 'on-silence.md')).toBe('on-silence');
    expect(docTitle('## only a subheading', 'notes.markdown')).toBe('notes');
    expect(docTitle('', 'plain.txt')).toBe('plain');
    expect(docTitle(undefined, undefined)).toBe('');
  });

  test('handles an Arabic title', () => {
    expect(docTitle('# القراءة حِرفة\n\nنص', 'x.md')).toBe('القراءة حِرفة');
  });
});

describe('encodingLabel', () => {
  test.each([
    [{ encoding: 'utf8' }, 'UTF-8'],
    [{ encoding: 'UTF-8' }, 'UTF-8'],
    [{ encoding: 'windows-1256' }, 'Windows-1256'],
    [{ encoding: 'cp1256' }, 'Windows-1256'],
    [{ encoding: 'latin1' }, 'LATIN1'],
    [{}, 'UTF-8'],
    [null, 'UTF-8'],
    [{ encoding: 42 }, 'UTF-8'],
  ])('%j reads %s', (meta, label) => {
    expect(encodingLabel(meta)).toBe(label);
  });
});

describe('eolLabel', () => {
  test('trusts the disk metadata', () => {
    expect(eolLabel({ eol: '\r\n' }, 'a\nb')).toBe('CRLF');
    expect(eolLabel({ eol: '\n' }, 'a\r\nb')).toBe('LF');
  });

  test('detects from the content when there is no metadata', () => {
    expect(eolLabel(undefined, 'a\r\nb')).toBe('CRLF');
    expect(eolLabel({}, 'a\nb')).toBe('LF');
    expect(eolLabel(null, undefined)).toBe('LF');
    expect(eolLabel({ eol: '\r\n', eolMixed: true }, 'a\nb')).toBe('Mixed'); // audit M5
    expect(eolLabel({ eol: '\r\n', eolMixed: false }, 'a\nb')).toBe('CRLF');
    expect(eolLabel({ eolMixed: true }, '', 'مختلط')).toBe('مختلط'); // QA-L2
  });
});

describe('inspectorData', () => {
  const file = {
    name: 'essay.md', path: 'essays/essay.md', content: `# Essay\n\n${'word '.repeat(438)}`, forcedDir: null, meta: { encoding: 'windows-1256', eol: '\r\n' },
  };

  test('collects the header, the stats and the file properties', () => {
    const data = inspectorData({ file, ratio: 0.426, rootName: 'Notes' });
    expect(data).toEqual({
      title: 'Essay',
      path: 'Notes / essays / essay.md',
      dir: 'ltr',
      words: 440,
      minutes: 2,
      percent: 43,
      encoding: 'Windows-1256',
      eol: 'CRLF',
      legacyEncoding: true,
    });
  });

  test('a UTF-8 file is not flagged and a missing ratio is 0%', () => {
    const data = inspectorData({ file: { name: 'a.md', path: 'a.md', content: 'hi', meta: { encoding: 'utf8' } }, ratio: 0, rootName: 'Open files' });
    expect(data.legacyEncoding).toBe(false);
    expect(data.percent).toBe(0);
    expect(data.path).toBe('Open files / a.md');
  });

  test('is null without a file', () => {
    expect(inspectorData({ file: null, ratio: 0, rootName: 'x' })).toBeNull();
  });
});

describe('renderInspectorDoc', () => {
  const markup = `
    <header id="inspDoc" hidden>
      <h2 id="inspDocTitle"></h2><div id="inspDocPath"></div>
      <b id="statWords"></b><b id="statMin"></b><b id="statProgress"></b>
    </header>
    <span id="propEncoding"></span><span id="propEol"></span><span id="encodingStat" class="sb-stat">utf-8</span>`;

  const data = {
    title: 'القراءة', path: 'Notes / a.md', dir: 'rtl', words: 1234, minutes: 6, percent: 42, encoding: 'UTF-8', eol: 'LF', legacyEncoding: false,
  };

  test('fills the header, the stats and the properties and shows the header', () => {
    document.body.innerHTML = markup;
    renderInspectorDoc(document, data);
    const header = document.getElementById('inspDoc');
    expect(header.hidden).toBe(false);
    expect(header.dataset.d).toBe('rtl');
    expect(document.getElementById('inspDocTitle').textContent).toBe('القراءة');
    expect(document.getElementById('inspDocPath').textContent).toBe('Notes / a.md');
    expect(document.getElementById('statWords').textContent).toBe('1,234');
    expect(document.getElementById('statMin').textContent).toBe('6');
    expect(document.getElementById('statProgress').textContent).toBe('42%');
    expect(document.getElementById('propEncoding').textContent).toBe('UTF-8');
    expect(document.getElementById('propEol').textContent).toBe('LF');
    expect(document.getElementById('encodingStat').textContent).toBe('UTF-8 · LF');
    expect(document.getElementById('encodingStat').classList.contains('warn')).toBe(false);
  });

  test('a legacy encoding warns in the status bar', () => {
    document.body.innerHTML = markup;
    renderInspectorDoc(document, { ...data, encoding: 'Windows-1256', eol: 'CRLF', legacyEncoding: true });
    expect(document.getElementById('encodingStat').textContent).toBe('Windows-1256 · CRLF');
    expect(document.getElementById('encodingStat').classList.contains('warn')).toBe(true);
  });

  test('null data hides the header and clears the properties', () => {
    document.body.innerHTML = markup;
    renderInspectorDoc(document, { ...data, legacyEncoding: true });
    renderInspectorDoc(document, null);
    expect(document.getElementById('inspDoc').hidden).toBe(true);
    expect(document.getElementById('propEncoding').textContent).toBe('—');
    expect(document.getElementById('propEol').textContent).toBe('—');
    expect(document.getElementById('encodingStat').textContent).toBe('UTF-8');
    expect(document.getElementById('encodingStat').classList.contains('warn')).toBe(false);
  });

  test('renderInspectorProgress updates only the percentage', () => {
    document.body.innerHTML = markup;
    renderInspectorDoc(document, data);
    renderInspectorProgress(document, 0.8);
    expect(document.getElementById('statProgress').textContent).toBe('80%');
    expect(document.getElementById('statWords').textContent).toBe('1,234');
    renderInspectorProgress(document, 2);
    expect(document.getElementById('statProgress').textContent).toBe('100%');
    renderInspectorProgress(document, -1);
    expect(document.getElementById('statProgress').textContent).toBe('0%');
  });

  test('tolerates a page without the inspector', () => {
    document.body.innerHTML = '';
    expect(() => renderInspectorDoc(document, data)).not.toThrow();
    expect(() => renderInspectorProgress(document, 0.5)).not.toThrow();
  });
});

describe('edge cases pinned by mutation review', () => {
  test('only a trailing extension is stripped from the fallback title', () => {
    expect(docTitle('', 'notes.md.bak')).toBe('notes.md.bak');
  });

  test('an unrecognised metadata line ending falls back to the content', () => {
    expect(eolLabel({ eol: '\r' }, 'a\r\nb')).toBe('CRLF');
    expect(eolLabel({ eol: '\r' }, 'a\nb')).toBe('LF');
  });
});

describe('status bar folio', () => {
  const bar = '<span id="sbProgress" hidden></span><button id="zoomBtn">100%</button><b id="statProgress"></b>';
  const data = {
    title: 't', path: 'p', dir: 'ltr', words: 10, minutes: 1, percent: 42, encoding: 'UTF-8', eol: 'LF', legacyEncoding: false,
  };

  test('the reading bar shows the document percentage', () => {
    document.body.innerHTML = bar;
    renderInspectorDoc(document, data);
    const el = document.getElementById('sbProgress');
    expect(el.hidden).toBe(false);
    expect(el.style.getPropertyValue('--p')).toBe('0.42');
  });

  test('the reading bar hides when no document is open', () => {
    document.body.innerHTML = bar;
    renderInspectorDoc(document, data);
    renderInspectorDoc(document, null);
    expect(document.getElementById('sbProgress').hidden).toBe(true);
  });

  test('live progress moves and clamps the bar', () => {
    document.body.innerHTML = bar;
    renderInspectorProgress(document, 0.8);
    expect(document.getElementById('sbProgress').style.getPropertyValue('--p')).toBe('0.8');
    expect(document.getElementById('sbProgress').hidden).toBe(false);
    renderInspectorProgress(document, 3);
    expect(document.getElementById('sbProgress').style.getPropertyValue('--p')).toBe('1');
    renderInspectorProgress(document, -1);
    expect(document.getElementById('sbProgress').style.getPropertyValue('--p')).toBe('0');
  });

  test.each([[1, '100%'], [1.1, '110%'], [0.6, '60%'], [1.2100000000000002, '121%'], [2, '200%'], [NaN, '100%'], [undefined, '100%']])(
    'zoomLabel(%s) is %s',
    (factor, label) => {
      expect(zoomLabel(factor)).toBe(label);
    },
  );

  test('renderZoom writes the label and tolerates a missing button', () => {
    document.body.innerHTML = bar;
    renderZoom(document, 1.5);
    expect(document.getElementById('zoomBtn').textContent).toBe('150%');
    document.body.innerHTML = '';
    expect(() => renderZoom(document, 1)).not.toThrow();
  });
});
