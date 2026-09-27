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
      const unchanged = target[key] === value;
      target[key] = value;
      if (!unchanged) listeners.forEach(fn => fn(key, value));
      return true;
    },
    deleteProperty(target, key) {
      const existed = key in target;
      delete target[key];
      if (existed) listeners.forEach(fn => fn(key, undefined));
      return true;
    }
  });

  return { state, subscribe };
}
