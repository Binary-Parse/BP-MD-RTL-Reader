import { describe, test, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createGuardedIpc, guardIpc, APP_ORIGIN } = require('../../src/main/ipc-guard.js');

// QA-M3: no IPC handler checked which frame sent the message.
function setup() {
  const handlers = {};
  const ipcMain = {
    handle: vi.fn((ch, fn) => { handlers[ch] = fn; }),
    on: vi.fn((ch, fn) => { handlers[ch] = fn; }),
  };
  const log = vi.fn();
  const guarded = createGuardedIpc(ipcMain, { trustedOrigin: APP_ORIGIN, log });
  const listener = vi.fn(() => 'ok');
  guarded.handle('fs:read', listener);
  guarded.on('doc:dirty-state', listener);
  return { handlers, listener, log };
}

const mainFrame = { origin: 'app://ui' };
const trusted = { sender: { mainFrame }, senderFrame: mainFrame };

describe('ipc guard', () => {
  test('the app\'s own top frame reaches the handler', () => {
    const { handlers, listener } = setup();
    expect(handlers['fs:read'](trusted, 'a.md')).toBe('ok');
    handlers['doc:dirty-state'](trusted, 1);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith(trusted, 'a.md');
  });

  test.each([
    ['a gone frame', { sender: { mainFrame }, senderFrame: null }],
    ['another origin', { sender: { mainFrame: { origin: 'https://evil.test' } }, senderFrame: { origin: 'https://evil.test' } }],
    ['a subframe of the app page', { sender: { mainFrame }, senderFrame: { origin: 'app://ui' } }],
    ['a hand-made event', {}],
  ])('%s is refused and logged', (_, event) => {
    const { handlers, listener, log } = setup();
    expect(handlers['fs:read'](event)).toEqual({ error: 'untrusted-sender' });
    expect(handlers['doc:dirty-state'](event)).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(2);
  });

  test('bootstrap installs it only inside Electron', () => {
    const ipcMain = { handle: vi.fn(), on: vi.fn() };
    expect(guardIpc(ipcMain, { proc: { versions: {} }, writeLog: vi.fn() })).toBe(ipcMain);
    const guarded = guardIpc(ipcMain, { proc: { versions: { electron: '44.7.0' } }, writeLog: vi.fn() });
    expect(guarded).not.toBe(ipcMain);
    expect(Object.keys(guarded).sort()).toEqual(['handle', 'on']);
  });
});
