/**
 * state.js — Proxy-based observable state store
 * Pure factory: no DOM, no side effects.
 */

export function createState(initial = {}) {
  const listeners = new Set();

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  const state = new Proxy({ ...initial }, {
    set(target, key, value) {
      target[key] = value;
      listeners.forEach(fn => fn(key, value));
      return true;
    }
  });

  return { state, subscribe };
}
