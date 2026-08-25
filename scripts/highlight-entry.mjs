import hljs from 'highlight.js';

// Classic-script consumers use window.hljs. Keep that API while deriving the
// browser bundle from the exact package version in package-lock.json.
globalThis.hljs = hljs;
