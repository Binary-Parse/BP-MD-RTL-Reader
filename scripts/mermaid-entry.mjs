import mermaid from 'mermaid';

// Classic-script consumers use window.mermaid. Built from the ESM package rather than copied
// from mermaid's prebuilt dist, so the KaTeX and DOMPurify inside are the versions that
// package.json overrides pin (D11), not the ones mermaid's own build inlined.
globalThis.mermaid = mermaid;
