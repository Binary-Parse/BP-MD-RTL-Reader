// @vitest-environment jsdom
import { describe, test, expect } from 'vitest';
import { svgIcon, hydrateIcons } from '../../src/renderer/icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('svgIcon', () => {
  test('builds a namespaced svg that references the sprite symbol', () => {
    const svg = svgIcon('search');
    expect(svg.namespaceURI).toBe(SVG_NS);
    expect(svg.tagName).toBe('svg');
    expect(svg.getAttribute('class')).toBe('ic');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    const use = svg.firstElementChild;
    expect(use.namespaceURI).toBe(SVG_NS);
    expect(use.tagName).toBe('use');
    expect(use.getAttribute('href')).toBe('#ic-search');
  });

  test('accepts a custom class list', () => {
    expect(svgIcon('x', 'ic dd-ic').getAttribute('class')).toBe('ic dd-ic');
  });
});

describe('hydrateIcons', () => {
  test('replaces every data-ic placeholder with an svg and keeps its class', () => {
    document.body.innerHTML = '<div id="root"><span class="slot a" data-ic="copy"></span><p><span data-ic="folder"></span></p></div>';
    const root = document.getElementById('root');
    hydrateIcons(root);
    expect(root.querySelectorAll('[data-ic]').length).toBe(0);
    const icons = root.querySelectorAll('svg');
    expect(icons.length).toBe(2);
    expect(icons[0].getAttribute('class')).toBe('ic slot a');
    expect(icons[0].firstElementChild.getAttribute('href')).toBe('#ic-copy');
    expect(icons[1].getAttribute('class')).toBe('ic');
    expect(icons[1].firstElementChild.getAttribute('href')).toBe('#ic-folder');
  });

  test('is a no-op without placeholders and tolerates a missing root', () => {
    document.body.innerHTML = '<div id="root"><b>text</b></div>';
    hydrateIcons(document.getElementById('root'));
    expect(document.getElementById('root').innerHTML).toBe('<b>text</b>');
    expect(() => hydrateIcons(null)).not.toThrow();
  });
});
