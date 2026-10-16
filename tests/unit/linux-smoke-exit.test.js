/**
 * linux-smoke-exit.test.js — the packaged Linux smoke script must never end with status 0
 * when the app it drives crashed. A crashed Electron reports exitCode null and a signal
 * (SIGTRAP); the script waited for an 'exit' event that had already fired, the event loop
 * emptied, and node quit with status 0 and no message — a crash read as a pass.
 */
import { describe, test, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { waitForExit } = require('../packaged/linux-smoke.js');

function fakeChild({ exitCode = null, signalCode = null } = {}) {
  return Object.assign(new EventEmitter(), { exitCode, signalCode });
}

describe('linux-smoke waitForExit', () => {
  test('a child that already ended by a signal resolves at once', async () => {
    await expect(waitForExit(fakeChild({ signalCode: 'SIGTRAP' }))).resolves.toBeUndefined();
  });

  test('a child that already exited with a code resolves at once', async () => {
    await expect(waitForExit(fakeChild({ exitCode: 1 }))).resolves.toBeUndefined();
  });

  test('a running child resolves on its exit event', async () => {
    const child = fakeChild();
    const done = waitForExit(child);
    child.emit('exit', null, 'SIGTERM');
    await expect(done).resolves.toBeUndefined();
  });

  test('a child that never started (spawn error) resolves on the error event', async () => {
    const child = fakeChild();
    const done = waitForExit(child);
    child.emit('error', new Error('spawn ENOENT'));
    await expect(done).resolves.toBeUndefined();
  });
});
