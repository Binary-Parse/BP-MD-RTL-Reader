const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgIcon(name, cls = 'ic') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#ic-${name}`);
  svg.appendChild(use);
  return svg;
}

export function hydrateIcons(root) {
  if (!root) return;
  for (const slot of root.querySelectorAll('[data-ic]')) {
    const extra = slot.getAttribute('class');
    slot.replaceWith(svgIcon(slot.getAttribute('data-ic'), extra ? `ic ${extra}` : 'ic'));
  }
}
